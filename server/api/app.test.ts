import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/schemas";
import { createTestDb } from "../../tests/helpers/pglite-db";
import type { DbHandle } from "../db/client";
import type { FetchClient } from "../http/fetch-client";
import { silentLogger } from "../logger";
import { makeListing } from "../../tests/helpers/factories";
import { assignProperty } from "../dedup/match";
import { upsertListings } from "../db/queries/listings";
import { createApp } from "./app";

let handle: DbHandle;
const fetchClient: FetchClient = { get: async () => ({ status: 500, headers: new Headers(), text: "" }) };

beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => handle.close());

const json = (body: unknown, method = "POST") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("API", () => {
  it("serves health, settings and an empty property list", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, appSecret: "" });
    expect((await app.request("/api/health")).status).toBe(200);
    const settings = await (await app.request("/api/settings")).json();
    expect(settings.center).toEqual(DEFAULT_SETTINGS.center);
    const bad = await app.request("/api/settings", json({ ...DEFAULT_SETTINGS, radiusKm: 0 }, "PUT"));
    expect(bad.status).toBe(400);
    const ok = await app.request("/api/settings", json({ ...DEFAULT_SETTINGS, radiusKm: 20 }, "PUT"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).radiusKm).toBe(20);
    const props = await (await app.request("/api/properties?kinds=plot&priceMax=300000")).json();
    expect(props.items).toEqual([]);
    expect((await app.request("/api/properties/999")).status).toBe(404);
    expect((await app.request("/api/properties/abc")).status).toBe(400);
  });

  it("starts, reports and cancels scrape runs", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, appSecret: "" });
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
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, appSecret: "s3cret" });
    expect((await app.request("/api/settings")).status).toBe(200);
    expect((await app.request("/api/scrape/cancel", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/scrape/cancel", { method: "POST", headers: { "x-app-secret": "s3cret" } })).status).toBe(200);
    expect((await app.request("/api/notify/test", { method: "POST", headers: { "x-app-secret": "s3cret" } })).status).toBe(400);
  });

  it("lists all listings as a sortable, searchable, paginated table", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, appSecret: "" });
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

  it("ignores a listing: the property disappears from the map until 'show ignored' is on", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, appSecret: "" });
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
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, appSecret: "" });
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

  it("probes a source and resets its app-side block", async () => {
    const app = createApp({ db: handle.db, dbKind: "pglite", log: silentLogger, notifiers: [], fetchClient, olxFetchClient: fetchClient, appSecret: "" });
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
