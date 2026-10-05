import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/schemas";
import { createTestDb } from "../../tests/helpers/pglite-db";
import type { DbHandle } from "../db/client";
import type { FetchClient } from "../http/fetch-client";
import { silentLogger } from "../logger";
import { eq } from "drizzle-orm";
import { makeListing } from "../../tests/helpers/factories";
import { assignProperty, createPropertyFromListing } from "../dedup/match";
import { upsertListings } from "../db/queries/listings";
import { listings } from "../db/schema";
import { createApp } from "./app";

let handle: DbHandle;
const fetchClient: FetchClient = { get: async () => ({ status: 500, headers: new Headers(), text: "" }) };
const noSleep = async () => {};

beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => handle.close());

const json = (body: unknown, method = "POST") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("API", () => {
  it("serves health, settings and an empty property list", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, sleep: noSleep, appSecret: "" });
    const health = await (await app.request("/api/health")).json();
    expect(health).toMatchObject({ ok: true, db: "pglite", schemaReady: true });
    const settings = await (await app.request("/api/settings")).json();
    expect(settings.center).toEqual(DEFAULT_SETTINGS.center);
    const bad = await app.request("/api/settings", json({ ...DEFAULT_SETTINGS, radiusKm: 0 }, "PUT"));
    expect(bad.status).toBe(400);
    // Centre and radius are derived from the rectangle, whatever the client sent for them.
    const ok = await app.request("/api/settings", json({ ...DEFAULT_SETTINGS, radiusKm: 20, area: { south: 49.9, west: 20.0, north: 50.0, east: 20.2 } }, "PUT"));
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.radiusKm).toBe(10);
    expect(okBody.center).toEqual({ lat: 49.95, lon: 20.1 });
    // Every portal's query follows the rectangle (OLX keeps its id: the lookup fails with the stub client).
    expect(okBody.otodom).toMatchObject({ locationPath: "malopolskie/wielicki/wieliczka", radiusKm: 10 });
    expect(okBody.olx).toMatchObject({ cityId: DEFAULT_SETTINGS.olx.cityId, cityName: "Wieliczka", distanceKm: 10 });
    expect(okBody.domiporta.location).toBe("malopolskie/wieliczka");
    expect(okBody.nieruchomosci_online.location).toBe("Wieliczka");
    expect(okBody.gratka.location.split(", ")).toContain("gmina-wieliczka");
    expect(okBody.morizon.location.split(", ")).toContain("wielicki/gmina-wieliczka");
    expect((await app.request("/api/settings", json(DEFAULT_SETTINGS, "PUT"))).status).toBe(200);
    // Portal radii are validated as integers 0–100 even though they are derived from the area on save.
    const otodomTooFar = await app.request("/api/settings", json({ ...DEFAULT_SETTINGS, otodom: { ...DEFAULT_SETTINGS.otodom, radiusKm: 101 } }, "PUT"));
    expect(otodomTooFar.status).toBe(400);
    const props = await (await app.request("/api/properties?kinds=plot&priceMax=300000")).json();
    expect(props.items).toEqual([]);
    expect((await app.request("/api/properties/999")).status).toBe(404);
    expect((await app.request("/api/properties/abc")).status).toBe(400);
  });

  it("starts, reports and cancels scrape runs", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, sleep: noSleep, appSecret: "" });
    const started = await app.request("/api/scrape", json({ mode: "incremental" }));
    expect(started.status).toBe(201);
    const again = await app.request("/api/scrape", json({ mode: "incremental" }));
    expect(again.status).toBe(409);
    const status = await (await app.request("/api/scrape/status")).json();
    expect(status.currentRun.mode).toBe("incremental");
    expect(status.queue.queued).toBeGreaterThan(0);
    const cancelled = await (await app.request("/api/scrape/cancel", { method: "POST" })).json();
    expect(cancelled.cancelled).toBeGreaterThan(0);
    const runs = await (await app.request("/api/scrape/runs?limit=5")).json();
    expect(runs.runs[0].status).toBe("cancelled");
  });

  it("requires the shared secret for writes when configured", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, sleep: noSleep, appSecret: "s3cret" });
    expect((await app.request("/api/settings")).status).toBe(200);
    expect((await app.request("/api/scrape/cancel", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/scrape/cancel", { method: "POST", headers: { "x-app-secret": "s3cret" } })).status).toBe(200);
    expect((await app.request("/api/notify/test", { method: "POST", headers: { "x-app-secret": "s3cret" } })).status).toBe(400);
  });

  it("lists all listings as a sortable, searchable, paginated table", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, sleep: noSleep, appSecret: "" });
    const now = new Date("2026-10-03T12:00:00Z");
    await upsertListings(
      handle.db,
      [
        makeListing({ source: "olx", sourceId: "T1", title: "Działka w Grabiu", city: "Grabie", price: 150_000 }),
        makeListing({ source: "olx", sourceId: "T2", title: "Dom z ogrodem", kind: "house", city: "Wieliczka", price: 800_000, areaM2: 120, plotAreaM2: 700 }),
        makeListing({ source: "olx", sourceId: "T3", title: "Bez ceny", city: "Wieliczka", price: null, pricePerM2: null }),
      ],
      now,
    );
    await upsertListings(handle.db, [makeListing({ source: "otodom", sourceId: "T4", title: "Łąka pod lasem", city: "Grabie", price: 90_000 })], now);

    const all = await (await app.request("/api/listings")).json();
    expect(all.total).toBe(4);
    expect(all.rows).toHaveLength(4);
    expect(all.rows.every((r: { url: string }) => r.url.startsWith("https://"))).toBe(true);

    const byPrice = await (await app.request("/api/listings?sort=price&dir=asc")).json();
    expect(byPrice.rows.map((r: { price: number | null }) => r.price)).toEqual([90_000, 150_000, 800_000, null]);

    const search = await (await app.request("/api/listings?q=grab")).json();
    expect(search.total).toBe(2);
    const bySource = await (await app.request("/api/listings?source=otodom")).json();
    expect(bySource.rows.map((r: { sourceId: string }) => r.sourceId)).toEqual(["T4"]);
    const houses = await (await app.request("/api/listings?kind=house")).json();
    expect(houses.rows[0].plotAreaM2).toBe(700);

    const page2 = await (await app.request("/api/listings?pageSize=10&page=2")).json();
    expect(page2.rows).toHaveLength(0);
    expect(page2.page).toBe(2);
    const invalid = await (await app.request("/api/listings?sort=nope&pageSize=99999&source=otodom")).json();
    expect(invalid.pageSize).toBe(100);
    expect(invalid.rows.map((r: { sourceId: string }) => r.sourceId)).toEqual(["T4"]); // valid fields survive
  });

  it("filters the table by numeric ranges and ignores or restores every match in bulk", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, sleep: noSleep, appSecret: "" });
    const now = new Date("2026-10-04T09:00:00Z");
    const seeded = await upsertListings(
      handle.db,
      [
        makeListing({ source: "olx", sourceId: "BULK1", title: "Bulk mała działka", areaM2: 500, lat: 49.93, lon: 20.3 }),
        makeListing({ source: "olx", sourceId: "BULK2", title: "Bulk średnia działka", areaM2: 790, lat: 49.94, lon: 20.31 }),
        makeListing({ source: "olx", sourceId: "BULK3", title: "Bulk duża działka", areaM2: 1500, price: 400_000, lat: 49.95, lon: 20.32 }),
      ],
      now,
    );
    const propertyIds: number[] = [];
    for (const row of seeded) propertyIds.push((await assignProperty(handle.db, row.id, { now })).propertyId!);
    const ids = (page: { rows: { sourceId: string }[] }) => page.rows.map((r) => r.sourceId).sort();

    expect(ids(await (await app.request("/api/listings?q=Bulk&areaMax=800")).json())).toEqual(["BULK1", "BULK2"]);
    expect(ids(await (await app.request("/api/listings?q=Bulk&areaMin=1000&priceMin=300000")).json())).toEqual(["BULK3"]);
    expect(ids(await (await app.request("/api/listings?q=Bulk&priceMax=250000&areaMin=600")).json())).toEqual(["BULK2"]);
    expect((await (await app.request("/api/listings?q=Bulk&areaMax=abc")).json()).total).toBe(3); // an invalid bound is dropped, not the whole query

    // "do 8 arów" → every matching listing, across all pages, in one call.
    const ignored = await (await app.request("/api/listings/bulk-ignore?q=Bulk&areaMax=800", json({ ignored: true }))).json();
    expect(ignored).toEqual({ updated: 2, properties: 2 });
    expect(await (await app.request("/api/listings/bulk-ignore?q=Bulk&areaMax=800", json({ ignored: true }))).json()).toEqual({ updated: 0, properties: 0 });
    expect(ids(await (await app.request("/api/listings?q=Bulk&ignored=only")).json())).toEqual(["BULK1", "BULK2"]);
    const mapDefault = await (await app.request("/api/properties?kinds=plot")).json();
    const shownIds = mapDefault.items.map((p: { id: number }) => p.id);
    expect(shownIds).not.toContain(propertyIds[0]);
    expect(shownIds).not.toContain(propertyIds[1]);
    expect(shownIds).toContain(propertyIds[2]);

    const restored = await (await app.request("/api/listings/bulk-ignore?q=Bulk&ignored=only", json({ ignored: false }))).json();
    expect(restored).toEqual({ updated: 2, properties: 2 });
    expect((await (await app.request("/api/listings?q=Bulk&ignored=only")).json()).total).toBe(0);
    expect((await (await app.request("/api/properties?kinds=plot")).json()).items.map((p: { id: number }) => p.id)).toContain(propertyIds[0]);
  });

  it("counts and prunes listings outside the search area", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, sleep: noSleep, appSecret: "" });
    const now = new Date("2026-10-04T12:00:00Z");
    // Default area is a 30 km square around Wieliczka; Zakopane is far outside it.
    const [far] = await upsertListings(handle.db, [makeListing({ source: "olx", sourceId: "FAR1", lat: 49.29, lon: 19.95, city: "Zakopane", title: "Działka Zakopane" })], now);
    await assignProperty(handle.db, far!.id, { now });
    const before = await (await app.request("/api/area/outside")).json();
    expect(before.count).toBeGreaterThanOrEqual(1);
    const pruned = await (await app.request("/api/area/prune", { method: "POST" })).json();
    expect(pruned.deleted).toBe(before.count);
    expect((await (await app.request("/api/area/outside")).json()).count).toBe(0);
    const rows = await handle.db.select().from(listings).where(eq(listings.id, far!.id));
    expect(rows).toHaveLength(0);
  });

  it("re-matches listings in resumable batches", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, sleep: noSleep, appSecret: "" });
    const now = new Date("2026-10-04T11:00:00Z");
    // Two copies of one plot that were assigned separately (e.g. before a rules change).
    const [a] = await upsertListings(handle.db, [makeListing({ source: "olx", sourceId: "RM1", lat: 49.91, lon: 20.31, areaM2: 900, price: 180_000, title: "Działka Grabie 9 ar" })], now);
    const [b] = await upsertListings(handle.db, [makeListing({ source: "domiporta", sourceId: "RM2", lat: 49.9101, lon: 20.3101, areaM2: 900, price: 180_000, title: "Grabie działka 900 m2" })], now);
    const first = await assignProperty(handle.db, a!.id, { now });
    await handle.db.update(listings).set({ propertyId: null }).where(eq(listings.id, b!.id));
    const pb = await createPropertyFromListing(handle.db, (await handle.db.select().from(listings).where(eq(listings.id, b!.id)))[0]!, { now });
    expect(pb).not.toBe(first.propertyId);

    let afterId = 0;
    let moved = 0;
    let calls = 0;
    for (;;) {
      const res = await (await app.request(`/api/dedup/reassign?afterId=${afterId}`, { method: "POST" })).json();
      calls += 1;
      moved += res.moved;
      if (res.nextAfterId === null) break;
      afterId = res.nextAfterId;
      expect(calls).toBeLessThan(100);
    }
    expect(moved).toBeGreaterThanOrEqual(1);
    // Both copies end up in one property (whichever won); the emptied one is gone.
    const [rowA] = await handle.db.select().from(listings).where(eq(listings.id, a!.id));
    const [rowB] = await handle.db.select().from(listings).where(eq(listings.id, b!.id));
    expect(rowA!.propertyId).toBe(rowB!.propertyId);
    const emptied = rowA!.propertyId === first.propertyId ? pb : first.propertyId!;
    expect((await app.request(`/api/properties/${emptied}`)).status).toBe(404);
  });

  it("ignores a listing: the property disappears from the map until 'show ignored' is on", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, sleep: noSleep, appSecret: "" });
    const now = new Date("2026-10-04T08:00:00Z");
    const [a] = await upsertListings(handle.db, [makeListing({ source: "olx", sourceId: "IGN1", title: "Ignorowana działka", lat: 49.95, lon: 20.2 })], now);
    const [b] = await upsertListings(handle.db, [makeListing({ source: "otodom", sourceId: "IGN2", title: "Ignorowana działka", lat: 49.9501, lon: 20.2001 })], now);
    const assigned = await assignProperty(handle.db, a!.id, { now });
    const second = await assignProperty(handle.db, b!.id, { now });
    expect(second.propertyId).toBe(assigned.propertyId);
    const pid = assigned.propertyId!;

    const visible = await (await app.request(`/api/properties?kinds=plot`)).json();
    expect(visible.items.map((p: { id: number }) => p.id)).toContain(pid);

    // Ignoring one of two listings keeps the property visible, aggregated from the other listing.
    const first = await (await app.request(`/api/listings/${a!.id}/ignore`, json({ ignored: true }))).json();
    expect(first.listing.ignored).toBe(true);
    expect(first.property.ignored).toBe(false);
    expect(first.property.sources).toEqual(["otodom"]);

    // Ignoring the last listing ignores the whole property: hidden by default, shown with ignored=include.
    const last = await (await app.request(`/api/listings/${b!.id}/ignore`, json({ ignored: true }))).json();
    expect(last.property.ignored).toBe(true);
    const def = await (await app.request(`/api/properties?kinds=plot`)).json();
    expect(def.items.map((p: { id: number }) => p.id)).not.toContain(pid);
    const shown = await (await app.request(`/api/properties?kinds=plot&ignored=include`)).json();
    expect(shown.items.find((p: { id: number }) => p.id === pid)?.ignored).toBe(true);
    const only = await (await app.request(`/api/properties?kinds=plot&ignored=only`)).json();
    expect(only.items.map((p: { id: number }) => p.id)).toEqual([pid]);

    // The offers table can filter ignored rows and shows the flag.
    const table = await (await app.request("/api/listings?ignored=only")).json();
    expect(table.rows.map((r: { sourceId: string }) => r.sourceId).sort()).toEqual(["IGN1", "IGN2"]);
    const hidden = await (await app.request("/api/listings?ignored=hide&q=Ignorowana")).json();
    expect(hidden.total).toBe(0);

    // Restoring brings the property back.
    const restored = await (await app.request(`/api/listings/${a!.id}/ignore`, json({ ignored: false }))).json();
    expect(restored.property.ignored).toBe(false);
    expect(restored.property.sources).toEqual(["olx"]);
    expect((await app.request("/api/listings/999999/ignore", json({ ignored: true }))).status).toBe(404);
  });

  it("marks favorites and ignores whole properties from the map popup", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, sleep: noSleep, appSecret: "" });
    const now = new Date("2026-10-04T09:00:00Z");
    const [a] = await upsertListings(handle.db, [makeListing({ source: "olx", sourceId: "FAV1", title: "Ulubiona działka", lat: 49.93, lon: 20.25 })], now);
    const [b] = await upsertListings(handle.db, [makeListing({ source: "otodom", sourceId: "FAV2", title: "Ulubiona działka", lat: 49.9301, lon: 20.2501 })], now);
    const pid = (await assignProperty(handle.db, a!.id, { now })).propertyId!;
    expect((await assignProperty(handle.db, b!.id, { now })).propertyId).toBe(pid);

    const onlyBefore = await (await app.request("/api/properties?favorites=only")).json();
    expect(onlyBefore.items.map((p: { id: number }) => p.id)).not.toContain(pid);
    const fav = await (await app.request(`/api/properties/${pid}/favorite`, json({ favorite: true }))).json();
    expect(fav.favorite).toBe(true);
    const onlyAfter = await (await app.request("/api/properties?favorites=only")).json();
    expect(onlyAfter.items.map((p: { id: number }) => p.id)).toEqual([pid]);
    const all = await (await app.request("/api/properties")).json();
    expect(all.items.find((p: { id: number }) => p.id === pid)?.favorite).toBe(true);

    // Property-level ignore flags every listing; the favorite flag survives recomputation.
    const ignored = await (await app.request(`/api/properties/${pid}/ignore`, json({ ignored: true }))).json();
    expect(ignored.ignored).toBe(true);
    expect(ignored.favorite).toBe(true);
    const rows = await (await app.request("/api/listings?q=Ulubiona")).json();
    expect(rows.rows.every((r: { ignored: boolean }) => r.ignored)).toBe(true);
    const def = await (await app.request("/api/properties?favorites=only")).json();
    expect(def.items.map((p: { id: number }) => p.id)).toEqual([]);
    const restored = await (await app.request(`/api/properties/${pid}/ignore`, json({ ignored: false }))).json();
    expect(restored.ignored).toBe(false);
    expect((await app.request(`/api/properties/${pid}/favorite`, json({ favorite: false }))).status).toBe(200);
    expect((await app.request("/api/properties/999999/favorite", json({ favorite: true }))).status).toBe(404);
  });

  it("resolves the OLX city for the area centre only within the home voivodeship, through the rate limiter", async () => {
    // Full-text fallback only (the town page answers 404); the candidate's region decides whether the id is adopted.
    const olxStub = (region: string, log: string[]): FetchClient => ({
      get: async (url) => {
        log.push(url);
        if (url.includes("/nieruchomosci/")) return { status: 404, headers: new Headers(), text: "" };
        const data = [{ location: { city: { id: 777, name: "Wieliczka", normalized_name: "wieliczka" }, region: { name: region } } }];
        return { status: 200, headers: new Headers(), text: JSON.stringify({ data }) };
      },
    });
    const reset = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, sleep: noSleep, appSecret: "" });
    await reset.request("/api/sources/olx/reset", { method: "POST" }); // earlier saves used up part of the 10-minute window

    const farLog: string[] = [];
    const far = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: olxStub("Mazowieckie", farLog), sleep: noSleep, appSecret: "" });
    const kept = await (await far.request("/api/settings", json(DEFAULT_SETTINGS, "PUT"))).json();
    expect(kept.olx).toMatchObject({ cityId: DEFAULT_SETTINGS.olx.cityId, cityName: "Wieliczka" });
    expect(farLog.length).toBeGreaterThan(0);

    const near = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: olxStub("Małopolskie", []), sleep: noSleep, appSecret: "" });
    const adopted = await (await near.request("/api/settings", json(DEFAULT_SETTINGS, "PUT"))).json();
    expect(adopted.olx.cityId).toBe(777);

    // The lookups count against OLX's window like every other request to the portal.
    const status = await (await near.request("/api/scrape/status")).json();
    expect(status.sources.find((x: { source: string }) => x.source === "olx").requestsLast10Min).toBeGreaterThan(0);
    await near.request("/api/settings", json(DEFAULT_SETTINGS, "PUT")); // restore the default id for the tests below
  });

  it("probes a source and resets its app-side block", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, sleep: noSleep, appSecret: "" });
    const probe = await (await app.request("/api/sources/olx/probe")).json();
    expect(probe.ok).toBe(false);
    expect(probe.status).toBe(500);
    expect(probe.state.source).toBe("olx");
    const { updateSourceState } = await import("../db/queries/source-state");
    await updateSourceState(handle.db, "olx", { blockedUntil: new Date(Date.now() + 3_600_000), consecutiveBlocks: 2, lastError: "HTTP 403" });
    const before = await (await app.request("/api/scrape/status")).json();
    expect(before.sources.find((x: { source: string }) => x.source === "olx").blockedUntil).not.toBeNull();
    const reset = await (await app.request("/api/sources/olx/reset", { method: "POST" })).json();
    expect(reset.blockedUntil).toBeNull();
    expect(reset.consecutiveBlocks).toBe(0);
    expect((await app.request("/api/sources/nope/probe")).status).toBe(400);
  });
});
