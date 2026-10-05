import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kind, Source } from "../../shared/constants";
import { DEFAULT_SETTINGS } from "../../shared/schemas";
import { createTestDb } from "../../tests/helpers/pglite-db";
import { makeListing } from "../../tests/helpers/factories";
import type { DbHandle } from "../db/client";
import { cancelOpenJobs, getLease, jobCounts, listRuns } from "../db/queries/jobs";
import { saveSettings } from "../db/queries/settings";
import { silentLogger } from "../logger";
import type { NormalizedListing, SourceAdapter } from "../sources/types";
import { startRun } from "./plans";
import { isWithinActiveHours, runScheduledTick } from "./tick";

const clock = { t: Date.parse("2026-10-05T10:00:00Z") }; // 12:00 in Warsaw
const now = () => new Date(clock.t);

function fakeAdapter(id: Source, items: Record<Kind, NormalizedListing[]>): SourceAdapter {
  return {
    id,
    label: id,
    rate: { minIntervalMs: 0, maxPer10Min: 10_000, maxPerSlice: 10_000 },
    estimatedPageCostMs: 1,
    initialCursor: (kind, mode) => ({ kind, mode, page: 0 }),
    async fetchListPage(cursor) {
      return { items: items[cursor.kind], total: items[cursor.kind].length, totalPages: 1, hasMore: false, parseErrors: 0 };
    },
    nextCursor: () => null,
  };
}

let handle: DbHandle;
beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => handle.close());

const adapters = { olx: fakeAdapter("olx", { plot: [makeListing({ source: "olx", sourceId: "TICK1" })], house: [] }) };
const tick = () => runScheduledTick({ db: handle.db, budgetMs: 60_000, now, log: silentLogger, adapters, notifiers: [], sources: ["olx"] });

describe("scheduled tick", () => {
  it("knows the active hours in Warsaw time, including windows past midnight", () => {
    const noon = new Date("2026-10-05T10:00:00Z");
    expect(isWithinActiveHours(noon, 6, 23)).toBe(true);
    expect(isWithinActiveHours(noon, 14, 24)).toBe(false);
    expect(isWithinActiveHours(new Date("2026-10-05T23:30:00Z"), 22, 6)).toBe(true); // 01:30 Warsaw
  });

  it("does nothing while automatic fetching is off, even with jobs queued", async () => {
    const { db } = handle;
    await cancelOpenJobs(db, now());
    const settings = await saveSettings(db, { ...DEFAULT_SETTINGS, kinds: ["plot"], autoScrape: { ...DEFAULT_SETTINGS.autoScrape, enabled: false } });
    const manual = await startRun(db, { mode: "incremental", trigger: "manual", settings, now: now(), adapters });
    expect(manual.ok).toBe(true);
    const result = await tick();
    expect(result).toEqual({ skipped: "disabled", started: [], summary: null });
    expect((await jobCounts(db)).queued).toBeGreaterThan(0); // left for the next click or CLI run
    await cancelOpenJobs(db, now());
  });

  it("starts an incremental run inside the active hours, fills the gap with a sweep and respects the interval", async () => {
    const { db } = handle;
    await saveSettings(db, { ...DEFAULT_SETTINGS, kinds: ["plot"], autoScrape: { enabled: true, intervalMin: 60, activeHours: { from: 0, to: 24 }, sweepEveryDays: 1 } });
    clock.t += 2 * 60 * 60_000; // the manual run above counts as the last incremental one
    const first = await tick();
    expect(first.skipped).toBeNull();
    expect(first.started).toEqual(["incremental"]);
    expect(first.summary?.completed).toBeGreaterThan(0);
    expect((await listRuns(db, 1))[0]).toMatchObject({ mode: "incremental", trigger: "schedule", status: "done" });
    expect(await getLease(db, now())).toBeNull(); // released, so a manual slice may follow right away

    clock.t += 5 * 60_000;
    const second = await tick();
    expect(second.started).toEqual(["sweep"]); // incremental not due yet, no sweep so far today
    expect((await listRuns(db, 1))[0]).toMatchObject({ mode: "sweep", status: "done" });

    clock.t += 5 * 60_000;
    const third = await tick();
    expect(third.started).toEqual([]); // neither is due; nothing queued either
    expect(third.summary?.processed).toBe(0);

    clock.t += 60 * 60_000;
    const fourth = await tick();
    expect(fourth.started).toEqual(["incremental"]);
  });

  it("stays idle outside the active hours", async () => {
    const { db } = handle;
    await saveSettings(db, { ...DEFAULT_SETTINGS, kinds: ["plot"], autoScrape: { enabled: true, intervalMin: 60, activeHours: { from: 20, to: 22 }, sweepEveryDays: 1 } });
    clock.t += 2 * 60 * 60_000;
    expect(await tick()).toEqual({ skipped: "inactive_hours", started: [], summary: null });
  });
});
