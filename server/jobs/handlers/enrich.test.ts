import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../../shared/schemas";
import { makeListing } from "../../../tests/helpers/factories";
import { createTestDb } from "../../../tests/helpers/pglite-db";
import type { DbHandle } from "../../db/client";
import { createRun, insertJobs } from "../../db/queries/jobs";
import { upsertListings } from "../../db/queries/listings";
import { saveSettings } from "../../db/queries/settings";
import { listings } from "../../db/schema";
import { silentLogger } from "../../logger";
import type { EnrichResult, SourceAdapter, SourceContext } from "../../sources/types";
import { handleEnrichJob } from "./enrich";

let handle: DbHandle;
beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => handle.close());

// A and B are the same plot (same exact spot, area and price); FAR lies outside the search area.
const coords: Record<string, { lat: number; lon: number }> = {
  A: { lat: 49.99, lon: 20.06 },
  B: { lat: 49.99, lon: 20.06 },
  C: { lat: 49.95, lon: 20.1 },
  D: { lat: 49.96, lon: 20.13 },
  E: { lat: 49.97, lon: 20.0 },
  FAR: { lat: 50.3, lon: 20.06 },
};

describe("enrich job", () => {
  it("fetches ad pages side by side but still merges duplicates into one property", async () => {
    const { db } = handle;
    const now = new Date("2026-10-04T14:00:00Z");
    const settings = await saveSettings(db, DEFAULT_SETTINGS);
    const items = Object.keys(coords).map((id) =>
      makeListing({ source: "otodom", sourceId: id, lat: null, lon: null, locationPrecision: "unknown", locationRadiusKm: null, areaM2: 1000, price: 200_000, title: `Działka ${id}` }),
    );
    await upsertListings(db, items, now);

    let inFlight = 0;
    let maxInFlight = 0;
    const adapter: SourceAdapter = {
      id: "otodom",
      label: "fake",
      rate: { minIntervalMs: 0, maxPer10Min: 1000, maxPerSlice: 100 },
      estimatedPageCostMs: 1,
      estimatedEnrichCostMs: 1,
      enrichConcurrency: 3,
      initialCursor: (kind, mode) => ({ kind, mode, page: 1 }),
      fetchListPage: async () => ({ items: [], total: 0, totalPages: 0, hasMore: false, parseErrors: 0 }),
      nextCursor: () => null,
      async enrich(listing): Promise<EnrichResult> {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight -= 1;
        const c = coords[listing.sourceId]!;
        return { status: "ok", patch: { lat: c.lat, lon: c.lon, locationPrecision: "exact", locationRadiusKm: 0 } };
      },
    };
    const run = await createRun(db, { mode: "backfill", trigger: "cli", now });
    const [job] = await insertJobs(db, [{ runId: run.id, type: "enrich", source: "otodom", kind: null, cursor: null, priority: 20, suppressNotifications: true, notBefore: now }]);
    const ctx: SourceContext = {
      http: { get: async () => ({ status: 200, headers: new Headers(), text: "" }), requestsThisSlice: 0 },
      settings,
      meta: {},
      setMeta: async () => {},
      log: silentLogger,
      now: () => now,
    };
    const result = await handleEnrichJob({ db, adapter, job: job!, run, ctx, now: () => now, remainingMs: () => 60_000, suppressNotifications: true, enrichConcurrency: 3 });
    expect(result.status).toBe("done");
    expect(result.stats.enriched).toBe(6);
    expect(result.stats.outsideArea).toBe(1);
    expect(maxInFlight).toBeGreaterThan(1);

    const rows = await db.select().from(listings).where(eq(listings.source, "otodom"));
    expect(rows.map((r) => r.sourceId).sort()).toEqual(["A", "B", "C", "D", "E"]); // FAR was deleted
    expect(rows.every((r) => r.lat !== null && r.propertyId !== null)).toBe(true);
    const a = rows.find((r) => r.sourceId === "A")!;
    const b = rows.find((r) => r.sourceId === "B")!;
    expect(a.propertyId).toBe(b.propertyId);
    expect(new Set(rows.map((r) => r.propertyId)).size).toBe(4);
  });
});
