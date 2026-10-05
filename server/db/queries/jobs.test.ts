import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../../../tests/helpers/pglite-db";
import type { DbHandle } from "../client";
import { createRun, earliestOpenListJob, insertJobs, mergeStats } from "./jobs";

let handle: DbHandle;
beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => handle.close());

describe("job stats and queue lookups", () => {
  it("sums every counter, including listings dropped outside the area", () => {
    const merged = mergeStats({ pages: 1, outsideArea: 2, errors: ["a"] }, { pages: 1, outsideArea: 3, enriched: 4 });
    expect(merged).toEqual({ pages: 2, outsideArea: 5, enriched: 4, errors: ["a"] });
    expect(mergeStats({}, { requests: 0 })).toEqual({});
  });

  it("finds the earliest open list job of a source in a run", async () => {
    const { db } = handle;
    const now = new Date("2026-10-05T12:00:00Z");
    const run = await createRun(db, { mode: "incremental", trigger: "manual", now });
    const later = new Date(now.getTime() + 30_000);
    await insertJobs(db, [
      { runId: run.id, type: "list", source: "otodom", kind: "plot", cursor: null, priority: 10, suppressNotifications: false, notBefore: later },
      { runId: run.id, type: "list", source: "otodom", kind: "house", cursor: null, priority: 20, suppressNotifications: false, notBefore: now, status: "done" },
      { runId: run.id, type: "list", source: "olx", kind: "plot", cursor: null, priority: 10, suppressNotifications: false, notBefore: now },
      { runId: run.id, type: "enrich", source: "otodom", kind: null, cursor: null, priority: 50, suppressNotifications: false, notBefore: now },
    ]);
    expect(await earliestOpenListJob(db, run.id, "otodom")).toEqual(later);
    expect(await earliestOpenListJob(db, run.id, "olx")).toEqual(now);
    expect(await earliestOpenListJob(db, run.id, "gratka")).toBeNull();
    expect(await earliestOpenListJob(db, run.id + 1, "otodom")).toBeNull();
  });
});
