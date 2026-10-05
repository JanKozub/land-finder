import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../../shared/schemas";
import { createTestDb } from "../../../tests/helpers/pglite-db";
import type { DbHandle } from "../client";
import { settings } from "../schema";
import { ensureSettings, repairSettings, seedSettings } from "./settings";

let handle: DbHandle;
beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => handle.close());

describe("stored settings", () => {
  it("seeds a fresh database with portal queries derived from the default rectangle", async () => {
    const seeded = await ensureSettings(handle.db);
    expect(seeded.center).toEqual(DEFAULT_SETTINGS.center);
    expect(seeded.radiusKm).toBe(DEFAULT_SETTINGS.radiusKm);
    // Every radius portal gets the covering circle; Otodom snaps up to a radius the portal supports.
    expect(seeded.olx).toMatchObject({ cityId: DEFAULT_SETTINGS.olx.cityId, cityName: "Wieliczka", distanceKm: seeded.radiusKm });
    expect(seeded.otodom).toMatchObject({ locationPath: "malopolskie/wielicki/wieliczka", radiusKm: 25 });
    expect(seeded.nieruchomosci_online.radiusKm).toBe(seeded.radiusKm);
    expect(seeded.domiporta.radiusKm).toBe(seeded.radiusKm);
    // Portals without radius search get the gminas the rectangle covers instead of one powiat.
    expect(seeded.gratka.location.split(", ")).toContain("gmina-wieliczka");
    expect(seeded.adresowo.location.split(", ").length).toBeGreaterThan(1);
    expect(seeded).toEqual(seedSettings());
    // The static defaults agree with themselves too (radii follow the rectangle's covering circle).
    expect(DEFAULT_SETTINGS.olx.distanceKm).toBe(DEFAULT_SETTINGS.radiusKm);
    expect(DEFAULT_SETTINGS.nieruchomosci_online.radiusKm).toBe(DEFAULT_SETTINGS.radiusKm);
  });

  it("repairs a stored row field by field instead of returning it unvalidated", async () => {
    const broken = { ...seedSettings(), kinds: ["house"], area: { south: 50.1, west: 20.0, north: 50.0, east: 20.2 }, alert: "nope" };
    const repaired = repairSettings(broken);
    expect(repaired.kinds).toEqual(["house"]); // valid fields survive
    expect(repaired.area).toEqual(DEFAULT_SETTINGS.area); // the inverted rectangle falls back
    expect(repaired.alert).toEqual(DEFAULT_SETTINGS.alert);
    expect(repairSettings("garbage")).toEqual(seedSettings());

    await handle.db.update(settings).set({ data: broken as never }).where(eq(settings.id, 1));
    const loaded = await ensureSettings(handle.db);
    expect(loaded.kinds).toEqual(["house"]);
    expect(loaded.center).toEqual(DEFAULT_SETTINGS.center);
  });
});
