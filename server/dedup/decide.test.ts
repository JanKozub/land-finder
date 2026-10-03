import { describe, expect, it } from "vitest";
import { decide, type DedupCandidate } from "./decide";
import { normalizeTitle } from "./normalize";

const base: DedupCandidate = {
  kind: "plot",
  lat: 49.99,
  lon: 20.06,
  locationPrecision: "exact",
  locationRadiusKm: 0,
  areaM2: 1200,
  plotAreaM2: null,
  price: 249_000,
  titleNorm: normalizeTitle("Działka budowlana 12 ar Wieliczka media w drodze"),
  advertiserKey: null,
  city: "Wieliczka",
};
const cand = (o: Partial<DedupCandidate>): DedupCandidate => ({ ...base, ...o });

describe("dedup decision rules", () => {
  it("matches the same plot posted on two portals with exact coordinates", () => {
    const other = cand({ lat: 49.9903, lon: 20.0604, price: 252_000, titleNorm: normalizeTitle("Wieliczka 1200 m2 budowlana") });
    expect(decide(base, other).match).toBe(true);
  });

  it("rejects different plots that share a village centroid", () => {
    const a = cand({ locationPrecision: "approx", locationRadiusKm: 3, titleNorm: normalizeTitle("Działka rolna Grabie przy lesie") });
    const b = cand({ locationPrecision: "approx", locationRadiusKm: 3, price: 250_000, titleNorm: normalizeTitle("Grunt pod inwestycję Podłęże dostęp do drogi") });
    expect(decide(a, b).match).toBe(false);
  });

  it("matches a repost with a lower price at the same exact spot", () => {
    const repost = cand({ price: Math.round(249_000 * 0.92) });
    const d = decide(base, repost);
    expect(d.match).toBe(true);
    expect(d.reason).toBe("exact+area+title");
  });

  it("never matches a house with a plot", () => {
    expect(decide(base, cand({ kind: "house" })).match).toBe(false);
  });

  it("matches an agency feed across portals when the seller matches", () => {
    const a = cand({ locationPrecision: "approx", locationRadiusKm: 2, advertiserKey: "agency:7", titleNorm: normalizeTitle("Oferta agencji działka 12 ar") });
    const b = cand({ lat: 49.995, lon: 20.07, advertiserKey: "agency:7", titleNorm: normalizeTitle("Wieliczka 1200 m2 na sprzedaż") });
    expect(decide(a, b).match).toBe(true);
  });

  it("rejects exact coordinates far apart or areas that differ", () => {
    expect(decide(base, cand({ lat: 50.01 })).match).toBe(false);
    expect(decide(base, cand({ areaM2: 1350 })).match).toBe(false);
  });

  it("handles unknown coordinates with city, area, price and title evidence", () => {
    const unknown = cand({ lat: null, lon: null, locationPrecision: "unknown", locationRadiusKm: null });
    expect(decide(unknown, base).match).toBe(true);
    expect(decide(unknown, cand({ city: "Kraków" })).match).toBe(false);
    expect(decide(unknown, cand({ titleNorm: normalizeTitle("Zupełnie inny tytuł oferty") })).match).toBe(false);
  });

  it("prefers strongly scored matches", () => {
    const exactSame = decide(base, cand({}));
    const weaker = decide(base, cand({ lat: 49.9908, price: null }));
    expect(exactSame.score).toBeGreaterThan(weaker.score);
  });
});
