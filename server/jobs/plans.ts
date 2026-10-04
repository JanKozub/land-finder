import { SOURCES, type Source } from "../../shared/constants";
import type { ScrapeMode, Settings } from "../../shared/schemas";
import type { Db } from "../db/client";
import { createRun, currentRun, insertJobs, openJobsExist, type NewJob } from "../db/queries/jobs";
import { countProperties } from "../db/queries/properties";
import type { ScrapeJobRow, ScrapeRunRow } from "../db/schema";
import { adapters as defaultAdapters, type AdapterRegistry } from "../sources";

export type StartRunResult =
  | { ok: true; run: ScrapeRunRow; jobs: ScrapeJobRow[] }
  | { ok: false; reason: "already_running" | "no_sources"; run: ScrapeRunRow | null };

export function enabledSources(settings: Settings): Source[] {
  return SOURCES.filter((s) => settings[s].enabled);
}

/** Creates a run with one list/sweep job per source and kind (+ an enrich job for sources that need it). */
export async function startRun(
  db: Db,
  input: {
    mode: ScrapeMode;
    trigger: ScrapeRunRow["trigger"];
    sources?: Source[] | null;
    settings: Settings;
    now: Date;
    adapters?: AdapterRegistry;
  },
): Promise<StartRunResult> {
  if (await openJobsExist(db)) return { ok: false, reason: "already_running", run: await currentRun(db) };
  const adapters = input.adapters ?? defaultAdapters;
  const enabled = enabledSources(input.settings);
  // A source without an adapter (not implemented, or absent from a test registry) is simply skipped.
  const chosen = (input.sources ?? enabled).filter((s) => enabled.includes(s) && adapters[s]);
  if (chosen.length === 0) return { ok: false, reason: "no_sources", run: null };

  const run = await createRun(db, { mode: input.mode, trigger: input.trigger, now: input.now });
  // Backfills and the very first fill of an empty database would announce hundreds of "new" offers.
  const initialFill = (await countProperties(db)).total === 0;
  const suppress = input.mode === "backfill" || initialFill;
  const jobs: NewJob[] = [];
  for (const source of chosen) {
    const adapter = adapters[source]!;
    for (const kind of input.settings.kinds) {
      jobs.push({
        runId: run.id,
        type: input.mode === "sweep" ? "sweep" : "list",
        source,
        kind,
        cursor: adapter.initialCursor(kind, input.mode, input.settings),
        priority: kind === "plot" ? 10 : 20,
        suppressNotifications: suppress,
        notBefore: input.now,
      });
    }
    if (adapter.enrich) {
      jobs.push({
        runId: run.id,
        type: "enrich",
        source,
        kind: null,
        cursor: null,
        priority: 50,
        suppressNotifications: suppress,
        notBefore: input.now,
      });
    }
  }
  const inserted = await insertJobs(db, jobs);
  return { ok: true, run, jobs: inserted };
}
