import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SettingsSchema, normalizeSettings, upgradeSettingsInput } from "./schemas";

describe("settings and the search area", () => {
  it("derives centre and covering radius from the rectangle", () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, area: { south: 49.9, west: 20.0, north: 50.0, east: 20.2 } });
    expect(s.center).toEqual({ lat: 49.95, lon: 20.1 });
    expect(s.radiusKm).toBe(10);
  });

  it("upgrades settings saved before the rectangle existed", () => {
    const legacy = { ...DEFAULT_SETTINGS, area: undefined, excludedGminy: undefined, center: { lat: 50.05, lon: 19.95 }, radiusKm: 10 } as Record<string, unknown>;
    delete legacy.area;
    delete legacy.excludedGminy;
    const parsed = SettingsSchema.parse(upgradeSettingsInput(legacy));
    expect(parsed.area.south).toBeCloseTo(50.05 - 10 / 111.32, 3);
    expect(parsed.area.east).toBeGreaterThan(19.95);
    expect(parsed.excludedGminy).toEqual([]);
    expect(normalizeSettings(parsed).center).toEqual({ lat: 50.05, lon: 19.95 });
  });

  it("rejects an empty or oversized rectangle", () => {
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, area: { south: 50, west: 20, north: 50, east: 20.1 } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, area: { south: 49, west: 19, north: 51, east: 22 } }).success).toBe(false);
  });
});
