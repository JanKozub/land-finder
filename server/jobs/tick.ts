import { TZDate } from "@date-fns/tz";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { latestRunByMode, openJobsExist } from "../db/queries/jobs";
import { ensureSettings } from "../db/queries/settings";
import { createLogger, type Logger } from "../logger";
import { startRun } from "./plans";
import { runWorker, type WorkerSummary } from "./worker";

export interface TickResult {
  skipped: "disabled" | "inactive_hours" | null;
  started: string[];
  summary: WorkerSummary | null;
}

export function isWithinActiveHours(now: Date, from: number, to: number, tz = "Europe/Warsaw"): boolean {
  const hour = new TZDate(now, tz).getHours();
  if (from === to) return true;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** One scheduled tick: keep the DB awake, start due runs, then work for `budgetMs`. */
export async function runScheduledTick(opts: { db: Db; budgetMs: number; now?: () => Date; log?: Logger }): Promise<TickResult> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? createLogger({ mod: "tick" });
  const t = now();
  await opts.db.execute(sql`select 1`);
  const settings = await ensureSettings(opts.db);
  if (!settings.autoScrape.enabled) return { skipped: "disabled", started: [], summary: null };
  const { from, to } = settings.autoScrape.activeHours;
  if (!isWithinActiveHours(t, from, to)) return { skipped: "inactive_hours", started: [], summary: null };

  const started: string[] = [];
  if (!(await openJobsExist(opts.db))) {
    const lastIncremental = await latestRunByMode(opts.db, "incremental");
    const intervalMs = settings.autoScrape.intervalMin * 60_000;
    const incrementalDue = !lastIncremental || t.getTime() - lastIncremental.startedAt.getTime() >= intervalMs - 60_000;
    if (incrementalDue) {
      const r = await startRun(opts.db, { mode: "incremental", trigger: "schedule", settings, now: t });
      if (r.ok) started.push("incremental");
    } else {
      const lastSweep = await latestRunByMode(opts.db, "sweep");
      const sweepMs = settings.autoScrape.sweepEveryDays * 86_400_000;
      if (!lastSweep || t.getTime() - lastSweep.startedAt.getTime() >= sweepMs) {
        const r = await startRun(opts.db, { mode: "sweep", trigger: "schedule", settings, now: t });
        if (r.ok) started.push("sweep");
      }
    }
  }
  const summary = await runWorker({ db: opts.db, budgetMs: opts.budgetMs, holder: "tick", now, log });
  log.info("tick finished", { started, summary });
  return { skipped: null, started, summary };
}
