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
  releaseLease,
} from "../db/queries/jobs";
import { expireByValidTo } from "../db/queries/listings";
import { recomputeProperties } from "../db/queries/properties";
import { ensureSettings } from "../db/queries/settings";
import { getSourceState, listSourceStates, patchSourceMeta } from "../db/queries/source-state";
import { scrapeJobs } from "../db/schema";
import { env } from "../env";
import { createFetchClient, type FetchClient } from "../http/fetch-client";
import { createSourceHttp } from "../http/rate-limiter";
import { createLogger, type Logger } from "../logger";
import { defaultNotifiers } from "../notify";
import { notifyNewProperties } from "../notify/run-notifications";
import type { Notifier } from "../notify/types";
import { adapters as defaultAdapters } from "../sources";
import type { SourceAdapter, SourceContext } from "../sources/types";
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
  adapters?: Record<Source, SourceAdapter>;
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
  const defaultClient = opts.fetchClient ?? createFetchClient();
  const olxClient = opts.olxFetchClient ?? (env.olxProxyUrl ? createFetchClient({ proxyUrl: env.olxProxyUrl }) : defaultClient);
  const clientFor = (source: Source): FetchClient => (source === "olx" ? olxClient : defaultClient);

  try {
    const settings = await ensureSettings(opts.db);
    const expired = await expireByValidTo(opts.db, now());
    if (expired.length) await recomputeProperties(opts.db, expired.map((e) => e.propertyId), now());

    while (remainingMs() > MIN_LOOP_MS) {
      const t = now();
      const states = await listSourceStates(opts.db);
      const blocked = states.filter((s) => s.blockedUntil && s.blockedUntil > t).map((s) => s.source);
      const job = await claimNextJob(opts.db, { sources: allowed, excludeSources: blocked, now: t });
      if (!job) break;
      const run = await getRun(opts.db, job.runId);
      if (!run || run.status !== "running") {
        await opts.db.update(scrapeJobs).set({ status: "cancelled", finishedAt: t }).where(eq(scrapeJobs.id, job.id));
        continue;
      }
      const adapter = adapters[job.source];
      const state = await getSourceState(opts.db, job.source);
      const jobLog = log.child({ job: job.id, source: job.source, type: job.type, kind: job.kind });
      const http = createSourceHttp({
        db: opts.db,
        source: job.source,
        rate: adapter.rate,
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
      const deps = { db: opts.db, adapter, job, run, ctx, now, remainingMs, suppressNotifications: job.suppressNotifications };
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
        const outcome = await failJob(opts.db, job.id, result.error ?? "unknown error", result.stats, tEnd);
        if (outcome === "failed") summary.failed += 1;
        jobLog.warn("job failed", { error: result.error, outcome });
      }
      await mergeRunStats(opts.db, job.runId, result.stats);
      await heartbeatLease(opts.db, holder, Math.max(remainingMs(), 0) + 60_000, tEnd);
      // A pause without a future notBefore means this invocation's budget is spent; stop re-claiming.
      if (result.status === "paused" && (!result.notBefore || result.notBefore.getTime() <= tEnd.getTime())) break;
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
