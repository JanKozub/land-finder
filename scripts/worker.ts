import { parseArgs } from "node:util";
import { SOURCES, type Source } from "../shared/constants";
import { ScrapeModeSchema } from "../shared/schemas";
import { createDb } from "../server/db/client";
import { currentRun, getLease, jobCounts, listJobs, releaseLease, requeueRunningJobs } from "../server/db/queries/jobs";
import { ensureSettings } from "../server/db/queries/settings";
import { env } from "../server/env";
import { startRun } from "../server/jobs/plans";
import { runWorker } from "../server/jobs/worker";
import { createLogger } from "../server/logger";

/**
 * Local worker: `pnpm worker --mode backfill [--sources olx,otodom] [--max-minutes 180]`.
 * Without --mode it only drains whatever is already queued. `--sources` picks the portals that get new jobs; the
 * worker itself drains the whole queue (set WORKER_SOURCES to restrict what this machine fetches).
 */
async function main() {
  const { values } = parseArgs({
    options: {
      mode: { type: "string" },
      sources: { type: "string" },
      "slice-ms": { type: "string", default: "60000" },
      "max-minutes": { type: "string", default: "240" },
      "database-url": { type: "string" },
    },
  });
  const log = createLogger({ mod: "cli" });
  const handle = await createDb(values["database-url"] ?? env.databaseUrl);
  const { db } = handle;
  const settings = await ensureSettings(db);
  const sources = values.sources
    ? (values.sources.split(",").map((s) => s.trim()) as Source[]).filter((s) => (SOURCES as readonly string[]).includes(s))
    : null;

  if (values.mode) {
    const mode = ScrapeModeSchema.parse(values.mode);
    const result = await startRun(db, { mode, trigger: "cli", sources, settings, now: new Date() });
    if (!result.ok) {
      console.error(`Cannot start run: ${result.reason}` + (result.run ? ` (run #${result.run.id} is active)` : ""));
      if (result.reason === "already_running") console.error("Draining the existing queue instead …");
      else process.exit(1);
    } else if (result.joined) {
      console.log(`Added ${result.jobs.length} jobs to the active run #${result.run.id} (${mode}).`);
    } else {
      console.log(`Run #${result.run.id} (${mode}) started with ${result.jobs.length} jobs.`);
    }
  }

  const sliceMs = Number(values["slice-ms"]) || 60_000;
  const deadline = Date.now() + (Number(values["max-minutes"]) || 240) * 60_000;
  const holder = `cli-${process.pid}`;
  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log("\nStopping: handing running jobs back to the queue (progress is saved per page and per offer) …");
    void (async () => {
      try {
        const t = new Date();
        await requeueRunningJobs(db, t);
        await releaseLease(db, holder, t);
        await handle.close();
      } finally {
        process.exit(0);
      }
    })();
  });
  const initial = await jobCounts(db);
  const active = await currentRun(db);
  console.log(
    `Queue: queued=${initial.queued} running=${initial.running}` +
      (active ? ` (run #${active.id}, ${active.mode})` : "") +
      `; working in slices of ${Math.round(sliceMs / 1000)} s, a summary line follows each one.`,
  );
  for (;;) {
    const summary = await runWorker({ db, budgetMs: sliceMs, holder, sources: null, log });
    const counts = await jobCounts(db);
    const run = await currentRun(db);
    console.log(
      `[${new Date().toISOString()}] processed=${summary.processed} completed=${summary.completed} paused=${summary.paused} failed=${summary.failed} ` +
        `queue: queued=${counts.queued} running=${counts.running} done=${counts.done} failed=${counts.failed}` +
        (run ? ` run#${run.id} stats=${JSON.stringify(run.stats)}` : ""),
    );
    if (summary.skipped === "locked") {
      // A worker that was killed without Ctrl+C leaves its lease behind for up to two minutes.
      const lease = await getLease(db, new Date());
      const leftMs = lease ? Math.max(0, lease.lockedUntil.getTime() - Date.now()) : 0;
      const waitMs = Math.min(15_000, Math.max(2000, leftMs + 1000));
      console.log(`Another worker (${lease?.holder ?? "?"}) holds the lease for ${Math.ceil(leftMs / 1000)} s more; waiting ${Math.round(waitMs / 1000)} s …`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (counts.queued === 0 && counts.running === 0) break;
    if (Date.now() > deadline) {
      console.log("Max runtime reached; jobs stay queued and will resume on the next run.");
      break;
    }
    // Wait until the earliest job becomes runnable (rate windows, blocks) — at most 60 s.
    const open = run ? await listJobs(db, run.id) : [];
    const next = open.filter((j) => j.status === "queued").map((j) => j.notBefore.getTime());
    const waitMs = next.length ? Math.min(60_000, Math.max(1000, Math.min(...next) - Date.now())) : 2000;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  await handle.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
