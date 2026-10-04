import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/schemas";
import { createTestDb } from "../../tests/helpers/pglite-db";
import type { DbHandle } from "../db/client";
import { listNotifications } from "../db/queries/notifications";
import { properties } from "../db/schema";
import { silentLogger } from "../logger";
import { escapeHtml, formatDigest } from "./format";
import { notifyNewProperties } from "./run-notifications";
import type { Notifier } from "./types";

let handle: DbHandle;
beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => handle.close());

const now = new Date("2026-10-03T18:00:00Z");

function makeProperty(o: Partial<typeof properties.$inferInsert> & { title: string }): typeof properties.$inferInsert {
  return {
    kind: "plot",
    lat: 49.99,
    lon: 20.06,
    locationPrecision: "exact",
    areaM2: 1200,
    price: 249_000,
    pricePerM2: 207.5,
    sources: ["otodom"],
    primaryUrl: "https://www.otodom.pl/pl/oferta/x-ID1",
    links: [{ source: "otodom", url: "https://www.otodom.pl/pl/oferta/x-ID1", active: true }],
    listingCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    isActive: true,
    hidden: false,
    city: "Wieliczka",
    ...o,
  };
}

describe("notifications", () => {
  it("formats a digest with links, prices and escaped HTML", () => {
    const text = formatDigest(
      [{ ...makeProperty({ title: "Działka <super> & tania" }), id: 7, locationRadiusKm: 0, plotAreaM2: null, priceMin: null, priceMax: null, district: null, isPrivate: true, hiddenAt: null, note: null, notifiedAt: null, manual: false, createdAt: now, updatedAt: now } as typeof properties.$inferSelect],
      { appBaseUrl: "https://app.example", center: DEFAULT_SETTINGS.center, total: 1, chunkIndex: 0, chunkCount: 1 },
    );
    expect(text).toContain("Nowe oferty: 1");
    expect(text).toContain('<a href="https://www.otodom.pl/pl/oferta/x-ID1">Otodom</a>');
    expect(text).toContain('<a href="https://app.example/?focus=7">Mapa</a>');
    expect(text).toContain("249 000 zł");
    expect(text).not.toContain("<super>");
    expect(escapeHtml("a<b>&")).toBe("a&lt;b&gt;&amp;");
  });

  it("sends only matching, unnotified properties and marks them", async () => {
    const { db } = handle;
    await db.insert(properties).values([
      makeProperty({ title: "Pasuje 1" }),
      makeProperty({ title: "Pasuje 2", price: 199_000 }),
      makeProperty({ title: "Za droga", price: 900_000 }),
      makeProperty({ title: "Ukryta", hidden: true }),
      makeProperty({ title: "Stara", firstSeenAt: new Date(now.getTime() - 10 * 86_400_000) }),
    ]);
    const sent: string[] = [];
    const notifier: Notifier = { id: "fake", isConfigured: () => true, send: async (t) => void sent.push(t) };
    const settings = { ...DEFAULT_SETTINGS, alert: { ...DEFAULT_SETTINGS.alert, maxPrice: 500_000 } };
    const res = await notifyNewProperties(db, { settings, notifiers: [notifier], appBaseUrl: "https://app.example", runId: null, now, log: silentLogger });
    expect(res).toEqual({ notified: 2, messages: 1 });
    expect(sent[0]).toContain("Pasuje 1");
    expect(sent[0]).not.toContain("Za droga");
    const again = await notifyNewProperties(db, { settings, notifiers: [notifier], appBaseUrl: "", runId: null, now, log: silentLogger });
    expect(again.notified).toBe(0);
    const log = await listNotifications(db);
    expect(log[0]!.status).toBe("sent");
    expect(log[0]!.propertyIds).toHaveLength(2);
  });

  it("keeps properties unnotified when sending fails", async () => {
    const { db } = handle;
    await db.insert(properties).values([makeProperty({ title: "Nowa po awarii", primaryUrl: "https://www.olx.pl/d/oferta/y.html" })]);
    const failing: Notifier = { id: "fake", isConfigured: () => true, send: async () => { throw new Error("boom"); } };
    const res = await notifyNewProperties(db, { settings: DEFAULT_SETTINGS, notifiers: [failing], appBaseUrl: "", runId: null, now, log: silentLogger });
    expect(res.notified).toBe(0);
    const log = await listNotifications(db);
    expect(log[0]!.status).toBe("failed");
    expect(log[0]!.error).toBe("boom");
  });

  it("collapses a large batch into one summary message", async () => {
    const { db } = handle;
    const many = Array.from({ length: 45 }, (_, i) => makeProperty({ title: `Partia ${i}`, primaryUrl: `https://www.otodom.pl/pl/oferta/batch-${i}`, lat: 49.9 + i * 0.001 }));
    await db.insert(properties).values(many);
    const sent: string[] = [];
    const notifier: Notifier = { id: "fake", isConfigured: () => true, send: async (t) => void sent.push(t) };
    const res = await notifyNewProperties(db, { settings: DEFAULT_SETTINGS, notifiers: [notifier], appBaseUrl: "https://app.example", runId: null, now, log: silentLogger });
    expect(res.messages).toBe(1);
    expect(res.notified).toBeGreaterThanOrEqual(45);
    expect(sent[0]).toContain("Duża partia");
    expect(sent[0]).toContain("addedWithinDays=1");
  });
});
