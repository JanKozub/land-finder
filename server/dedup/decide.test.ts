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

  it("treats a shared identity key as decisive, unless the coordinates are far apart", () => {
    const gratka = cand({ lat: null, lon: null, locationPrecision: "unknown", keys: ["mg:1543027761"], titleNorm: normalizeTitle("Działka na sprzedaż, 1005 m², Wieliczka") });
    const morizon = cand({ lat: null, lon: null, locationPrecision: "unknown", keys: ["mg:1543027761"], price: 260_000, areaM2: 1005, city: "Inne" });
    const d = decide(gratka, morizon);
    expect(d.match).toBe(true);
    expect(d.reason).toBe("identity:mg");
    const elsewhere = cand({ keys: ["mg:1543027761"], lat: 50.3, lon: 20.5 });
    expect(decide(cand({ keys: ["mg:1543027761"] }), elsewhere).match).toBe(false);
    expect(decide(cand({ keys: ["ref:44/8850/ogs"] }), cand({ keys: ["ref:other"] })).reason).not.toMatch(/identity/);
  });

  it("recognises the same agency across portals by name tokens", () => {
    const otodom = cand({ advertiserKey: "agency:7", sellerTokens: ["bracia", "sadurscy"], titleNorm: normalizeTitle("Działka pod zabudowę Siercza") });
    const no = cand({ locationPrecision: "approx", locationRadiusKm: 1, lat: 49.995, lon: 20.065, advertiserKey: "no:99", sellerTokens: ["bracia", "sadurscy", "bs5", "nowa", "huta"], titleNorm: normalizeTitle("Działka budowlana, ul. Krakowska") });
    const d = decide(no, otodom);
    expect(d.match).toBe(true);
    expect(d.reason).toBe("approx+area+price+evidence");
    // Different agencies with unrelated names stay separate when titles disagree.
    const other = cand({ ...no, sellerTokens: ["dkb"] });
    expect(decide(other, otodom).match).toBe(false);
  });

  it("accepts two exact pins a few hundred metres apart only with strong evidence", () => {
    const near = cand({ lat: 49.9935, lon: 20.06, titleNorm: normalizeTitle("Grunt inwestycyjny bez tytułu") }); // ~390 m
    expect(decide(base, near).match).toBe(false);
    expect(decide(base, cand({ ...near, sellerTokens: ["pacanowscy"] })).match).toBe(false); // seller only on one side
    expect(decide(cand({ sellerTokens: ["pacanowscy"] }), cand({ ...near, sellerTokens: ["pacanowscy"] })).match).toBe(true);
    expect(decide(base, cand({ lat: 50.005, lon: 20.06, sellerTokens: ["x"] })).reason).toBe("far"); // ~1.7 km
  });

  it("merges offers sharing one pin and identical figures even when the portal generated the title", () => {
    const olx = cand({ titleNorm: normalizeTitle("Gotowy dom z ogrodem - również dla osób spoza UE"), kind: "house", areaM2: 96.66, plotAreaM2: null, price: 1_199_000 });
    const no = cand({ ...olx, locationPrecision: "approx", locationRadiusKm: 1, titleNorm: normalizeTitle("Dom"), sellerTokens: ["neway"] });
    const d = decide(olx, no);
    expect(d.match).toBe(true);
    expect(d.reason).toBe("same_point+figures");
    // Slightly different figures or a different spot fall back to the regular rules.
    expect(decide(olx, { ...no, price: 1_200_000 }).match).toBe(false);
    expect(decide(olx, { ...no, lat: 49.992 }).match).toBe(false);
    expect(decide(olx, { ...no, areaM2: 97.5 }).reason).toBe("same_point+figures"); // within 1 %
  });

  it("ignores a differing plot size only for two exact pins on the same house", () => {
    const a = cand({ kind: "house", areaM2: 96, plotAreaM2: 500, price: 949_000, titleNorm: normalizeTitle("Dom do zamieszkania od zaraz blisko Krakowa") });
    const b = cand({ kind: "house", areaM2: 96.3, plotAreaM2: 620, price: 949_000, lat: 49.9908, titleNorm: normalizeTitle("Gotowy dom z ogrodem w Konarach 4 pokoje"), sellerTokens: ["dkb"] });
    expect(decide(a, b).match).toBe(true); // ~90 m apart, both exact
    expect(decide(a, { ...b, locationPrecision: "approx", locationRadiusKm: 1 }).reason).toBe("plot_area");
  });

  it("lets the same agency's house match despite a usable-vs-total area difference", () => {
    const house = cand({ kind: "house", areaM2: 250, plotAreaM2: 800, price: 1_200_000, sellerTokens: ["forma"], titleNorm: normalizeTitle("Dom wolnostojący Grabie 6 pokoi") });
    const total = cand({ kind: "house", areaM2: 282, plotAreaM2: 800, price: 1_200_000, sellerTokens: ["forma"], titleNorm: normalizeTitle("Dom Grabie 282 m2 6 pokoi garaż") });
    const d = decide(house, total);
    expect(d.match).toBe(true);
    expect(d.reason).toContain("area_loose");
    expect(decide(house, { ...total, sellerTokens: [], titleNorm: normalizeTitle("Zupełnie inna oferta w okolicy") }).reason).toBe("area");
    expect(decide(cand({ areaM2: 1000 }), cand({ areaM2: 1150, sellerTokens: ["forma"] })).reason).toBe("area"); // plots stay strict
  });
});
