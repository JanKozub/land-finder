import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../../shared/schemas";
import { createTestDb } from "../../../tests/helpers/pglite-db";
import { makeListing } from "../../../tests/helpers/factories";
import type { DbHandle } from "../../db/client";
import { createRun, insertJobs } from "../../db/queries/jobs";
import { saveSettings } from "../../db/queries/settings";
import { priceHistory } from "../../db/schema";
import { silentLogger } from "../../logger";
import type { Cursor, ListPage, SourceAdapter, SourceContext } from "../../sources/types";
import { handleListJob } from "./list";

let handle: DbHandle;
beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => handle.close());

describe("list job and the search area", () => {
  it("keeps listings inside the rectangle, drops the rest and records the portal total", async () => {
    const { db } = handle;
    const now = new Date("2026-10-04T13:00:00Z");
    const settings = await saveSettings(db, DEFAULT_SETTINGS);
    const inside = makeListing({ source: "olx", sourceId: "IN1", lat: 49.99, lon: 20.06 });
    const outside = makeListing({ source: "olx", sourceId: "OUT1", lat: 50.3, lon: 20.06, city: "Daleko" });
    const unlocated = makeListing({ source: "olx", sourceId: "UNL1", lat: null, lon: null, locationPrecision: "unknown", locationRadiusKm: null });
    const adapter: SourceAdapter = {
      id: "olx",
      label: "fake",
      rate: { minIntervalMs: 0, maxPer10Min: 1000, maxPerSlice: 100 },
      estimatedPageCostMs: 1,
      initialCursor: (kind, mode) => ({ kind, mode, page: 0 }),
      fetchListPage: async (): Promise<ListPage> => ({ items: [inside, outside, unlocated], total: 123, totalPages: 1, hasMore: false, parseErrors: 0 }),
      nextCursor: () => null,
    };
    const run = await createRun(db, { mode: "incremental", trigger: "manual", now });
    const [job] = await insertJobs(db, [{ runId: run.id, type: "list", source: "olx", kind: "plot", cursor: null, priority: 10, suppressNotifications: true, notBefore: now }]);
    const meta: Record<string, unknown> = {};
    const ctx: SourceContext = {
      http: { get: async () => ({ status: 200, headers: new Headers(), text: "" }), requestsThisSlice: 0 },
      settings,
      meta,
      setMeta: async (patch) => void Object.assign(meta, patch),
      log: silentLogger,
      now: () => now,
    };
    const result = await handleListJob({ db, adapter, job: job!, run, ctx, now: () => now, remainingMs: () => 60_000, suppressNotifications: true });
    expect(result.status).toBe("done");
    expect(result.stats.newListings).toBe(2); // inside + unlocated
    expect(result.stats.outsideArea).toBe(1);
    const totals = meta.totals as Record<string, Record<string, { total: number }>>;
    expect(totals.plot?.["0"]?.total).toBe(123);
    // The first observed price opens the history of every listing that has one.
    const history = await db.select().from(priceHistory);
    expect(history.map((h) => h.price)).toEqual([200_000, 200_000]);
    const cursor: Cursor = { kind: "plot", mode: "incremental", page: 0 };
    expect(cursor.page).toBe(0);
  });
});
