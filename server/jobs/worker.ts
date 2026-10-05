import { randomUUID } from "node:crypto";
import { SOURCES, type Source } from "../../shared/constants";
import type { Db } from "../db/client";
import {
  acquireLease,
  claimNextJob,
  completeJob,
  failJob,
  finalizeFinishedRuns,
  getRun,
  heartbeatLease,
  mergeRunStats,
  pauseJob,
  requeueRunningJobs,
  releaseLease,
} from "../db/queries/jobs";
import { expireByValidTo } from "../db/queries/listings";
import { recomputeProperties } from "../db/queries/properties";
import { ensureSettings } from "../db/queries/settings";
import { getSourceState, listSourceStates, patchSourceMeta } from "../db/queries/source-state";
import { scrapeJobs, type ScrapeJobRow } from "../db/schema";
import { env } from "../env";
import { clientForSource } from "../http/clients";
import { createFetchClient, type FetchClient } from "../http/fetch-client";
import { createSourceHttp } from "../http/rate-limiter";
import { createLogger, type Logger } from "../logger";
import { defaultNotifiers } from "../notify";
import { notifyNewProperties } from "../notify/run-notifications";
import type { Notifier } from "../notify/types";
import { adapters as defaultAdapters, type AdapterRegistry } from "../sources";
import type { SourceContext } from "../sources/types";
import { classifyError } from "./classify";
import { handleEnrichJob } from "./handlers/enrich";
import { handleListJob } from "./handlers/list";
import { emptyStats, type HandlerResult } from "./types";
import { eq } from "drizzle-orm";

export interface WorkerOptions {
  db: Db;
  budgetMs: number;
  holder?: string;
  /** Sources this process may scrape; defaults to env.WORKER_SOURCES or all. */
  sources?: Source[] | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: Logger;
  fetchClient?: FetchClient;
  olxFetchClient?: FetchClient;
  adapters?: AdapterRegistry;
  notifiers?: Notifier[];
  appBaseUrl?: string;
}

export interface WorkerSummary {
  skipped: "locked" | null;
  processed: number;
  completed: number;
  paused: number;
  failed: number;
  finalizedRuns: number[];
  notified: number;
  budgetMs: number;
  elapsedMs: number;
}

const MIN_LOOP_MS = 2000;
/** Jobs run concurrently per invocation, at most one per portal. */
const MAX_PARALLEL_JOBS = 7;

/**
 * Processes queued jobs until the time budget runs out. Safe to call from a 10 s function,
 * a 30 s scheduled function or an unbounded CLI loop — jobs pause with a cursor and resume later.
 */
export async function runWorker(opts: WorkerOptions): Promise<WorkerSummary> {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? createLogger({ mod: "worker" });
  const start = now().getTime();
  const deadline = start + opts.budgetMs;
  const remainingMs = () => deadline - now().getTime();
  const holder = opts.holder ?? `worker-${randomUUID().slice(0, 8)}`;
  const adapters = opts.adapters ?? defaultAdapters;
  const allowed = (opts.sources ?? (env.workerSources as Source[] | null) ?? [...SOURCES]).filter((s): s is Source =>
    (SOURCES as readonly string[]).includes(s),
  );
  const summary: WorkerSummary = {
    skipped: null,
    processed: 0,
    completed: 0,
    paused: 0,
    failed: 0,
    finalizedRuns: [],
    notified: 0,
    budgetMs: opts.budgetMs,
    elapsedMs: 0,
  };

  if (!(await acquireLease(opts.db, holder, opts.budgetMs + 60_000, now()))) {
    summary.skipped = "locked";
    return summary;
  }
  // Holding the lease means no other worker is executing anything, so jobs still marked "running" were abandoned.
  const orphaned = await requeueRunningJobs(opts.db, now());
  if (orphaned) log.warn("requeued jobs left running by an interrupted worker", { count: orphaned });
  const defaultClient = opts.fetchClient ?? createFetchClient();
  const olxClient = opts.olxFetchClient ?? clientForSource("olx", defaultClient);
  const clientFor = (source: Source): FetchClient => (source === "olx" ? olxClient : defaultClient);

  try {
    const settings = await ensureSettings(opts.db);
    const expired = await expireByValidTo(opts.db, now());
    if (expired.length) await recomputeProperties(opts.db, expired.map((e) => e.propertyId), now());

    // Run stats and the lease are shared rows; concurrent jobs update them one at a time.
    let chain: Promise<unknown> = Promise.resolve();
    const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
      const next = chain.then(fn, fn);
      chain = next.catch(() => undefined);
      return next;
    };

    /** Runs one claimed job to completion, pause or failure and records the outcome. */
    const runJob = async (job: ScrapeJobRow): Promise<HandlerResult | null> => {
      const t = now();
      const run = await getRun(opts.db, job.runId);
      if (!run || run.status !== "running") {
        await opts.db.update(scrapeJobs).set({ status: "cancelled", finishedAt: t }).where(eq(scrapeJobs.id, job.id));
        return null;
      }
      const adapter = adapters[job.source];
      if (!adapter) {
        // A job for a source without an adapter (disabled build, test registry) cannot run; fail it instead of looping.
        await opts.db.update(scrapeJobs).set({ status: "failed", finishedAt: t, lastError: `no adapter for ${job.source}` }).where(eq(scrapeJobs.id, job.id));
        return null;
      }
      const state = await getSourceState(opts.db, job.source);
      const jobLog = log.child({ job: job.id, source: job.source, type: job.type, kind: job.kind });
      // The per-invocation cap is sized for short function slices; a long CLI slice would otherwise sit idle after
      // a few dozen requests while the 10-minute window still has room. The minimum interval and the window stay.
      const maxPerSlice = Math.max(adapter.rate.maxPerSlice, Math.floor(opts.budgetMs / Math.max(1, adapter.rate.minIntervalMs)));
      const http = createSourceHttp({
        db: opts.db,
        source: job.source,
        rate: { ...adapter.rate, maxPerSlice },
        client: clientFor(job.source),
        remainingMs,
        now,
        sleep,
        log: jobLog,
      });
      const meta = { ...state.meta };
      const ctx: SourceContext = {
        http,
        settings,
        meta,
        setMeta: async (patch) => {
          Object.assign(meta, patch);
          await patchSourceMeta(opts.db, job.source, patch);
        },
        log: jobLog,
        now,
      };
      const deps = {
        db: opts.db,
        adapter,
        job,
        run,
        ctx,
        now,
        remainingMs,
        suppressNotifications: job.suppressNotifications,
        // several ad pages in flight only pay off in long CLI slices; a short function slice must not overrun its budget
        enrichConcurrency: opts.budgetMs >= 30_000 ? (adapter.enrichConcurrency ?? 1) : 1,
      };
      let result: HandlerResult;
      try {
        result = job.type === "enrich" ? await handleEnrichJob(deps) : await handleListJob(deps);
      } catch (err) {
        jobLog.error("job crashed", { err: err instanceof Error ? err.stack ?? err.message : String(err) });
        result = classifyError(err, job.cursor, emptyStats(), now());
      }
      result.stats.requests = (result.stats.requests ?? 0) + http.requestsThisSlice;
      summary.processed += 1;
      const tEnd = now();
      if (result.status === "done") {
        await completeJob(opts.db, job.id, result.stats, tEnd);
        summary.completed += 1;
      } else if (result.status === "paused") {
        await pauseJob(opts.db, job.id, result.cursor ?? null, result.notBefore ?? tEnd, result.stats, result.error);
        summary.paused += 1;
      } else {
        const outcome = await failJob(opts.db, job.id, result.error ?? "unknown error", result.stats, tEnd, result.cursor);
        if (outcome === "failed") summary.failed += 1;
        jobLog.warn("job failed", { error: result.error, outcome });
      }
      await serialized(() => mergeRunStats(opts.db, job.runId, result.stats));
      return result;
    };

    while (remainingMs() > MIN_LOOP_MS) {
      const t = now();
      const states = await listSourceStates(opts.db);
      const blocked = states.filter((s) => s.blockedUntil && s.blockedUntil > t).map((s) => s.source);
      // One job per portal at a time, portals in parallel: rate limits are per portal, and a short function
      // invocation would otherwise spend its whole budget waiting between two requests to a single site.
      const batch: ScrapeJobRow[] = [];
      const taken = new Set<Source>();
      while (batch.length < MAX_PARALLEL_JOBS) {
        const job = await claimNextJob(opts.db, { sources: allowed.filter((src) => !taken.has(src)), excludeSources: blocked, now: t });
        if (!job) break;
        batch.push(job);
        taken.add(job.source);
      }
      if (batch.length === 0) break;
      const results = await Promise.all(batch.map((job) => runJob(job)));
      const tEnd = now();
      await serialized(() => heartbeatLease(opts.db, holder, Math.max(remainingMs(), 0) + 60_000, tEnd));
      // A pause without a future notBefore means the budget is spent; stop when every job in the batch says so.
      const spent = results.filter((r): r is HandlerResult => r !== null);
      if (spent.length && spent.every((r) => r.status === "paused" && (!r.notBefore || r.notBefore.getTime() <= tEnd.getTime()))) break;
    }

    const finalized = await finalizeFinishedRuns(opts.db, now());
    summary.finalizedRuns = finalized.map((r) => r.id);
    if (finalized.length) {
      const notifiers = opts.notifiers ?? defaultNotifiers();
      const res = await notifyNewProperties(opts.db, {
        settings,
        notifiers,
        appBaseUrl: opts.appBaseUrl ?? env.appBaseUrl,
        runId: finalized[finalized.length - 1]!.id,
        now: now(),
        log,
      });
      summary.notified = res.notified;
    }
  } finally {
    await releaseLease(opts.db, holder, now());
    summary.elapsedMs = now().getTime() - start;
  }
  return summary;
}
