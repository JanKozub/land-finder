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

  it("never re-merges a pair the user split, even when the listings share an identity key", async () => {
    const { db } = handle;
    const now = new Date("2026-10-05T10:00:00Z");
    const shared = { lat: null, lon: null, locationPrecision: "unknown" as const, locationRadiusKm: null, areaM2: 2345, price: 333_000, city: "Zakrzów", title: "Działka widokowa Zakrzów 23 ary", attributes: { internalId: 999000111 } };
    const [gratka] = await upsertListings(db, [makeListing({ source: "gratka", sourceId: "SPLIT-G", ...shared })], now);
    const [morizon] = await upsertListings(db, [makeListing({ source: "morizon", sourceId: "SPLIT-M", ...shared })], now);
    const g = await assignProperty(db, gratka!.id, { now });
    expect((await assignProperty(db, morizon!.id, { now })).propertyId).toBe(g.propertyId);

    // "To nie ta sama oferta" on the Morizon copy: it gets its own property and an exclusion against its sibling.
    const detached = (await detachListing(db, morizon!.id, now))!;
    expect(detached.propertyId).not.toBe(g.propertyId);

    // The Gratka copy is not pinned; a price change sends it through dedup again. The shared platform id must not win.
    await db.update(listings).set({ price: 240_000 }).where(eq(listings.id, gratka!.id));
    const again = await assignProperty(db, gratka!.id, { now });
    expect(again.propertyId).toBe(g.propertyId);
    expect(again.reason).toBe("solo");
  });

  it("merges the same advertisement across portals by identity key, seller name and agency reference", async () => {
    const { db } = handle;
    const now = new Date("2026-10-04T10:00:00Z");
    // Gratka and Morizon: no coordinates yet, different public ids, same internal platform id.
    const [gratka] = await upsertListings(
      db,
      [makeListing({ source: "gratka", sourceId: "49041155", lat: null, lon: null, locationPrecision: "unknown", locationRadiusKm: null, areaM2: 1005, price: 250_000, city: "Wieliczka", title: "Działka na sprzedaż, 1005 m², Wieliczka", advertiserName: "DĘBOSZ Nieruchomości", advertiserId: "mg-agency:236681", attributes: { internalId: 1543027761 } })],
      now,
    );
    const g = await assignProperty(db, gratka!.id, { now });
    expect(g.created).toBe(true);
    const [morizon] = await upsertListings(
      db,
      [makeListing({ source: "morizon", sourceId: "mzn2048078266", lat: null, lon: null, locationPrecision: "unknown", locationRadiusKm: null, areaM2: 1005, price: 250_000, city: "Wieliczka", title: "Działka na sprzedaż, 1005 m², Wieliczka", advertiserName: "DĘBOSZ Nieruchomości", advertiserId: "mg-agency:236681", attributes: { internalId: 1543027761 } })],
      now,
    );
    const m = await assignProperty(db, morizon!.id, { now });
    expect(m.propertyId).toBe(g.propertyId);
    expect(m.reason).toBe("identity:mg");

    // Otodom exact pin vs nieruchomosci-online village centroid 900 m away, generated title, agency branch name.
    const [otodom] = await upsertListings(
      db,
      [makeListing({ source: "otodom", sourceId: "68400001", lat: 49.95, lon: 20.2, areaM2: 1200, price: 320_000, city: "Siercza", title: "Działka pod zabudowę jednorodzinną z widokiem Siercza", advertiserName: "BRACIA SADURSCY - ODDZIAŁ I", advertiserId: "agency:1", attributes: { externalId: "44/8850/OGS" } })],
      now,
    );
    const o = await assignProperty(db, otodom!.id, { now });
    expect(o.created).toBe(true);
    const [no] = await upsertListings(
      db,
      [makeListing({ source: "nieruchomosci_online", sourceId: "26000001", lat: 49.958, lon: 20.2, locationPrecision: "approx", locationRadiusKm: 1, areaM2: 1200, price: 320_000, city: "Siercza", title: "Działka budowlana, ul. Krakowska", advertiserName: "Bracia Sadurscy Nieruchomości", advertiserId: "no:555", attributes: {} })],
      now,
    );
    const n = await assignProperty(db, no!.id, { now });
    expect(n.propertyId).toBe(o.propertyId);
    expect(n.reason).toBe("approx+area+price+evidence");

    // Domiporta feed carrying the agency's CRM reference: matched before enrichment, even with a different area entry.
    const [domiporta] = await upsertListings(
      db,
      [makeListing({ source: "domiporta", sourceId: "156000001", lat: null, lon: null, locationPrecision: "unknown", locationRadiusKm: null, areaM2: 1180, price: 320_000, city: "Kraków", title: "Działka Siercza", advertiserName: "Bracia Sadurscy Oddział BS1", advertiserId: "domiporta:bracia", attributes: { offerNumber: "44/8850/OGS" } })],
      now,
    );
    const d = await assignProperty(db, domiporta!.id, { now });
    expect(d.propertyId).toBe(o.propertyId);
    expect(d.reason).toBe("identity:ref");
    const detail = (await getPropertyDetail(db, o.propertyId!))!;
    expect(detail.sources.sort()).toEqual(["domiporta", "nieruchomosci_online", "otodom"]);
  });
});
