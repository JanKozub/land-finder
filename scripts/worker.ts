import { parseArgs } from "node:util";
import { SOURCES, type Source } from "../shared/constants";
import { ScrapeModeSchema } from "../shared/schemas";
import { createDb } from "../server/db/client";
import { jobCounts, listJobs, currentRun } from "../server/db/queries/jobs";
import { ensureSettings } from "../server/db/queries/settings";
import { env } from "../server/env";
import { startRun } from "../server/jobs/plans";
import { runWorker } from "../server/jobs/worker";
import { createLogger } from "../server/logger";

/**
 * Local worker: `pnpm worker --mode backfill [--sources olx,otodom] [--max-minutes 180]`.
 * Without --mode it only drains whatever is already queued.
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
    } else {
      console.log(`Run #${result.run.id} (${mode}) started with ${result.jobs.length} jobs.`);
    }
  }

  const sliceMs = Number(values["slice-ms"]) || 60_000;
  const deadline = Date.now() + (Number(values["max-minutes"]) || 240) * 60_000;
  for (;;) {
    const summary = await runWorker({ db, budgetMs: sliceMs, holder: "cli", sources, log });
    const counts = await jobCounts(db);
    const run = await currentRun(db);
    console.log(
      `[${new Date().toISOString()}] processed=${summary.processed} completed=${summary.completed} paused=${summary.paused} failed=${summary.failed} ` +
        `queue: queued=${counts.queued} running=${counts.running} done=${counts.done} failed=${counts.failed}` +
        (run ? ` run#${run.id} stats=${JSON.stringify(run.stats)}` : ""),
    );
    if (summary.skipped === "locked") {
      console.log("Another worker holds the lease; waiting 15 s …");
      await new Promise((r) => setTimeout(r, 15_000));
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
