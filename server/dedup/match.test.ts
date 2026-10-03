import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../db/client";
import { detachListing, getPropertyDetail, mergeProperties } from "../db/queries/properties";
import { upsertListings, applyEnrichment } from "../db/queries/listings";
import { listings, properties } from "../db/schema";
import { createTestDb } from "../../tests/helpers/pglite-db";
import { makeListing } from "../../tests/helpers/factories";
import { assignProperty } from "./match";

let handle: DbHandle;
beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => handle.close());

describe("assignProperty", () => {
  it("creates, attaches, detaches with exclusions and merges", async () => {
    const { db } = handle;
    const now = new Date("2026-10-03T10:00:00Z");
    const [olx] = await upsertListings(db, [makeListing({ source: "olx", sourceId: "A" })], now);
    const first = await assignProperty(db, olx!.id, { now });
    expect(first.created).toBe(true);

    // Otodom copy arrives without coordinates, then gets enriched -> attaches to the same property.
    const [oto] = await upsertListings(
      db,
      [makeListing({ source: "otodom", sourceId: "B", lat: null, lon: null, locationPrecision: "unknown", locationRadiusKm: null, title: "Działka budowlana A Wieliczka" })],
      now,
    );
    await applyEnrichment(db, oto!.id, { lat: 49.9902, lon: 20.0603, locationPrecision: "exact", locationRadiusKm: 0 }, now, true);
    const second = await assignProperty(db, oto!.id, { now });
    expect(second.created).toBe(false);
    expect(second.propertyId).toBe(first.propertyId);

    const detail = (await getPropertyDetail(db, first.propertyId!))!;
    expect(detail.listingCount).toBe(2);
    expect(detail.sources.sort()).toEqual(["olx", "otodom"]);
    expect(detail.links.map((l) => l.source).sort()).toEqual(["olx", "otodom"]);
    expect(detail.url).toMatch(/^https:\/\//);

    // A different plot nearby must not be merged.
    const [other] = await upsertListings(db, [makeListing({ source: "olx", sourceId: "C", lat: 49.99, lon: 20.0601, areaM2: 1500, price: 300_000 })], now);
    const third = await assignProperty(db, other!.id, { now });
    expect(third.created).toBe(true);

    // Detach the Otodom listing: new property, exclusion recorded, and re-running dedup keeps them apart.
    const detached = (await detachListing(db, oto!.id, now))!;
    expect(detached.propertyId).not.toBe(first.propertyId);
    const again = await assignProperty(db, oto!.id, { now });
    expect(again.propertyId).toBe(detached.propertyId);
    const [row] = await db.select().from(listings).where(eq(listings.id, oto!.id));
    expect(row!.pinned).toBe(true);

    // Merge them back manually.
    const merged = (await mergeProperties(db, first.propertyId!, detached.propertyId, now))!;
    expect(merged.listingCount).toBe(2);
    const remaining = await db.select({ id: properties.id }).from(properties);
    expect(remaining.map((r) => r.id).sort()).toEqual([first.propertyId!, third.propertyId!].sort());
  });
});
