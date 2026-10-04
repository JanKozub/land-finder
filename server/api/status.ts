import type { ScrapeStatusDto } from "../../shared/schemas";
import type { Db } from "../db/client";
import { currentRun, getLease, jobCounts, listJobs } from "../db/queries/jobs";
import { countListings, listingsBySourceKind } from "../db/queries/listings";
import { countProperties } from "../db/queries/properties";
import { listSourceStates } from "../db/queries/source-state";
import { jobToDto, runToDto, sourceStateToDto } from "./dto";

export async function buildStatus(db: Db, now: Date): Promise<ScrapeStatusDto> {
  const run = await currentRun(db);
  const [queue, states, lease, listingCounts, propertyCounts, bySource] = await Promise.all([
    jobCounts(db, run?.id),
    listSourceStates(db),
    getLease(db, now),
    countListings(db),
    countProperties(db),
    listingsBySourceKind(db),
  ]);
  const jobs = run ? await listJobs(db, run.id) : [];
  return {
    currentRun: run ? runToDto(run) : null,
    queue: { queued: queue.queued, running: queue.running, done: queue.done, failed: queue.failed },
    jobs: jobs.map(jobToDto),
    sources: states.map((s) => sourceStateToDto(s, now)),
    lease: lease ? { holder: lease.holder, lockedUntil: lease.lockedUntil.toISOString() } : null,
    counts: {
      listings: listingCounts.total,
      activeListings: listingCounts.active,
      properties: propertyCounts.total,
      activeProperties: propertyCounts.active,
      hidden: propertyCounts.hidden,
      bySource,
    },
  };
}
