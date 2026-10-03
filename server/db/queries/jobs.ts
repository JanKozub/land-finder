import { and, asc, desc, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import type { Source } from "../../../shared/constants";
import type { RunStats, ScrapeMode } from "../../../shared/schemas";
import type { Db } from "../client";
import { scrapeJobs, scrapeRuns, workerLease, type ScrapeJobRow, type ScrapeRunRow } from "../schema";

export type NewJob = Omit<typeof scrapeJobs.$inferInsert, "id" | "createdAt">;

export async function createRun(db: Db, input: { mode: ScrapeMode; trigger: ScrapeRunRow["trigger"]; now: Date }): Promise<ScrapeRunRow> {
  const [run] = await db
    .insert(scrapeRuns)
    .values({ mode: input.mode, trigger: input.trigger, status: "running", startedAt: input.now, stats: {} })
    .returning();
  return run!;
}

export async function insertJobs(db: Db, jobs: NewJob[]): Promise<ScrapeJobRow[]> {
  if (jobs.length === 0) return [];
  return db.insert(scrapeJobs).values(jobs).returning();
}

export interface JobCounts {
  queued: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
}

export async function jobCounts(db: Db, runId?: number): Promise<JobCounts> {
  const rows = await db
    .select({ status: scrapeJobs.status, n: sql<number>`count(*)::int` })
    .from(scrapeJobs)
    .where(runId === undefined ? undefined : eq(scrapeJobs.runId, runId))
    .groupBy(scrapeJobs.status);
  const out: JobCounts = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export async function openJobsExist(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: scrapeJobs.id })
    .from(scrapeJobs)
    .where(inArray(scrapeJobs.status, ["queued", "running"]))
    .limit(1);
  return Boolean(row);
}

/** Atomically takes the next runnable job (FOR UPDATE SKIP LOCKED) and marks it running. */
export async function claimNextJob(
  db: Db,
  opts: { sources: Source[]; excludeSources?: Source[]; now: Date },
): Promise<ScrapeJobRow | null> {
  if (opts.sources.length === 0) return null;
  return db.transaction(async (tx) => {
    const conds = [eq(scrapeJobs.status, "queued"), lte(scrapeJobs.notBefore, opts.now), inArray(scrapeJobs.source, opts.sources)];
    if (opts.excludeSources?.length) conds.push(notInArray(scrapeJobs.source, opts.excludeSources));
    const [candidate] = await tx
      .select({ id: scrapeJobs.id })
      .from(scrapeJobs)
      .where(and(...conds))
      .orderBy(asc(scrapeJobs.priority), asc(scrapeJobs.id))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const [job] = await tx
      .update(scrapeJobs)
      .set({ status: "running", startedAt: opts.now, attempts: sql`${scrapeJobs.attempts} + 1` })
      .where(and(eq(scrapeJobs.id, candidate.id), eq(scrapeJobs.status, "queued")))
      .returning();
    return job ?? null;
  });
}

export function mergeStats(a: RunStats, b: RunStats): RunStats {
  const out: RunStats = { ...a };
  const keys = ["requests", "pages", "newListings", "updatedListings", "newProperties", "deactivated", "enriched"] as const;
  for (const k of keys) {
    const sum = (a[k] ?? 0) + (b[k] ?? 0);
    if (sum) out[k] = sum;
  }
  const errors = [...(a.errors ?? []), ...(b.errors ?? [])];
  if (errors.length) out.errors = errors.slice(-50);
  return out;
}

export async function completeJob(db: Db, id: number, stats: RunStats, now: Date): Promise<void> {
  const [job] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, id)).limit(1);
  await db
    .update(scrapeJobs)
    .set({ status: "done", finishedAt: now, cursor: null, stats: mergeStats(job?.stats ?? {}, stats), lastError: null })
    .where(eq(scrapeJobs.id, id));
}

export async function pauseJob(db: Db, id: number, cursor: Record<string, unknown> | null, notBefore: Date, stats: RunStats, note?: string): Promise<void> {
  const [job] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, id)).limit(1);
  await db
    .update(scrapeJobs)
    .set({
      status: "queued",
      cursor,
      notBefore,
      stats: mergeStats(job?.stats ?? {}, stats),
      lastError: note ?? null,
      // a pause is not an attempt
      attempts: sql`greatest(${scrapeJobs.attempts} - 1, 0)`,
    })
    .where(eq(scrapeJobs.id, id));
}

export async function failJob(db: Db, id: number, error: string, stats: RunStats, now: Date): Promise<"retry" | "failed"> {
  const [job] = await db.select().from(scrapeJobs).where(eq(scrapeJobs.id, id)).limit(1);
  if (!job) return "failed";
  const merged = mergeStats(job.stats, stats);
  if (job.attempts < job.maxAttempts) {
    const delayMs = 60_000 * 2 ** Math.max(0, job.attempts - 1);
    await db
      .update(scrapeJobs)
      .set({ status: "queued", notBefore: new Date(now.getTime() + delayMs), lastError: error, stats: merged })
      .where(eq(scrapeJobs.id, id));
    return "retry";
  }
  await db.update(scrapeJobs).set({ status: "failed", finishedAt: now, lastError: error, stats: merged }).where(eq(scrapeJobs.id, id));
  return "failed";
}

export async function cancelOpenJobs(db: Db, now: Date, runId?: number): Promise<number> {
  const conds = [inArray(scrapeJobs.status, ["queued", "running"])];
  if (runId !== undefined) conds.push(eq(scrapeJobs.runId, runId));
  const rows = await db.update(scrapeJobs).set({ status: "cancelled", finishedAt: now }).where(and(...conds)).returning({ id: scrapeJobs.id });
  await db
    .update(scrapeRuns)
    .set({ status: "cancelled", finishedAt: now })
    .where(runId !== undefined ? and(eq(scrapeRuns.id, runId), eq(scrapeRuns.status, "running")) : eq(scrapeRuns.status, "running"));
  return rows.length;
}

export async function listJobs(db: Db, runId: number, limit = 100): Promise<ScrapeJobRow[]> {
  return db.select().from(scrapeJobs).where(eq(scrapeJobs.runId, runId)).orderBy(asc(scrapeJobs.priority), asc(scrapeJobs.id)).limit(limit);
}

export async function mergeRunStats(db: Db, runId: number, delta: RunStats): Promise<void> {
  const [run] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, runId)).limit(1);
  if (!run) return;
  await db.update(scrapeRuns).set({ stats: mergeStats(run.stats, delta) }).where(eq(scrapeRuns.id, runId));
}

/** Runs with no open jobs become done (or partial when some jobs failed). Returns the runs just finalized. */
export async function finalizeFinishedRuns(db: Db, now: Date): Promise<ScrapeRunRow[]> {
  const running = await db.select().from(scrapeRuns).where(eq(scrapeRuns.status, "running"));
  const finalized: ScrapeRunRow[] = [];
  for (const run of running) {
    const counts = await jobCounts(db, run.id);
    if (counts.queued > 0 || counts.running > 0) continue;
    const status = counts.failed > 0 ? "partial" : "done";
    const [updated] = await db.update(scrapeRuns).set({ status, finishedAt: now }).where(eq(scrapeRuns.id, run.id)).returning();
    if (updated) finalized.push(updated);
  }
  return finalized;
}

export async function currentRun(db: Db): Promise<ScrapeRunRow | null> {
  const [run] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.status, "running")).orderBy(desc(scrapeRuns.id)).limit(1);
  return run ?? null;
}

export async function listRuns(db: Db, limit = 20): Promise<ScrapeRunRow[]> {
  return db.select().from(scrapeRuns).orderBy(desc(scrapeRuns.id)).limit(limit);
}

export async function latestRunByMode(db: Db, mode: ScrapeMode): Promise<ScrapeRunRow | null> {
  const [run] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.mode, mode)).orderBy(desc(scrapeRuns.id)).limit(1);
  return run ?? null;
}

export async function getRun(db: Db, id: number): Promise<ScrapeRunRow | null> {
  const [run] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, id)).limit(1);
  return run ?? null;
}

// ---- worker lease (single worker at a time) ----

export async function acquireLease(db: Db, holder: string, ttlMs: number, now: Date): Promise<boolean> {
  const lockedUntil = new Date(now.getTime() + ttlMs);
  const rows = await db
    .insert(workerLease)
    .values({ id: 1, holder, lockedUntil, heartbeatAt: now })
    .onConflictDoUpdate({
      target: workerLease.id,
      set: { holder, lockedUntil, heartbeatAt: now },
      setWhere: sql`${workerLease.lockedUntil} <= ${now} OR ${workerLease.holder} = ${holder}`,
    })
    .returning({ holder: workerLease.holder });
  return rows.length > 0;
}

export async function heartbeatLease(db: Db, holder: string, ttlMs: number, now: Date): Promise<void> {
  await db
    .update(workerLease)
    .set({ lockedUntil: new Date(now.getTime() + ttlMs), heartbeatAt: now })
    .where(and(eq(workerLease.id, 1), eq(workerLease.holder, holder)));
}

export async function releaseLease(db: Db, holder: string, now: Date): Promise<void> {
  await db.update(workerLease).set({ lockedUntil: now }).where(and(eq(workerLease.id, 1), eq(workerLease.holder, holder)));
}

export async function getLease(db: Db, now: Date): Promise<{ holder: string; lockedUntil: Date } | null> {
  const [row] = await db.select().from(workerLease).where(eq(workerLease.id, 1)).limit(1);
  if (!row || row.lockedUntil <= now) return null;
  return { holder: row.holder, lockedUntil: row.lockedUntil };
}
