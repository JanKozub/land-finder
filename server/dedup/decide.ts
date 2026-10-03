import type { Kind } from "../../shared/constants";
import { haversineKm } from "../../shared/geo";
import type { LocationPrecision } from "../../shared/schemas";
import { titleSimilarity } from "./title";

export interface DedupCandidate {
  kind: Kind;
  lat: number | null;
  lon: number | null;
  locationPrecision: LocationPrecision;
  locationRadiusKm: number | null;
  areaM2: number | null;
  plotAreaM2: number | null;
  price: number | null;
  titleNorm: string;
  advertiserKey: string | null;
  city: string | null;
}

export interface Decision {
  match: boolean;
  reason: string;
  score: number;
}

export const AREA_TOLERANCE = 0.03;
export const HOUSE_AREA_TOLERANCE = 0.05;
export const PRICE_TOLERANCE = 0.03;
export const EXACT_DISTANCE_KM = 0.15;
export const APPROX_MIN_DISTANCE_KM = 2;

function relDiff(a: number, b: number): number {
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m === 0 ? 0 : Math.abs(a - b) / m;
}

function tri(a: number | null, b: number | null, tol: number): boolean | null {
  if (a === null || b === null) return null;
  return relDiff(a, b) <= tol;
}

function sameCity(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

/** Pure matching rule: do two listings describe the same property? */
export function decide(a: DedupCandidate, b: DedupCandidate): Decision {
  const no = (reason: string): Decision => ({ match: false, reason, score: 0 });
  if (a.kind !== b.kind) return no("kind");

  const areaTol = a.kind === "house" ? HOUSE_AREA_TOLERANCE : AREA_TOLERANCE;
  const areaOk = tri(a.areaM2, b.areaM2, areaTol);
  const plotOk = a.kind === "house" ? tri(a.plotAreaM2, b.plotAreaM2, HOUSE_AREA_TOLERANCE) : null;
  const priceOk = tri(a.price, b.price, PRICE_TOLERANCE);
  if (areaOk === false) return no("area");
  if (plotOk === false) return no("plot_area");

  let geo: "unknown" | "same_exact" | "near_approx" | "far";
  let dist = 0;
  if (a.lat === null || a.lon === null || b.lat === null || b.lon === null) geo = "unknown";
  else {
    dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
    const bothExact = a.locationPrecision === "exact" && b.locationPrecision === "exact";
    if (bothExact) geo = dist <= EXACT_DISTANCE_KM ? "same_exact" : "far";
    else {
      const limit = Math.max(a.locationRadiusKm ?? 0, b.locationRadiusKm ?? 0, APPROX_MIN_DISTANCE_KM);
      geo = dist <= limit ? "near_approx" : "far";
    }
  }
  if (geo === "far") return no("far");

  const title = titleSimilarity(a.titleNorm, b.titleNorm);
  const t = title ?? 0;
  const sameSeller = Boolean(a.advertiserKey && b.advertiserKey && a.advertiserKey === b.advertiserKey);
  const yes = (reason: string): Decision => ({
    match: true,
    reason,
    score: 1 + t + (priceOk ? 0.5 : 0) + (sameSeller ? 0.25 : 0) - Math.min(dist, 10) / 10,
  });

  if (geo === "same_exact") {
    if (areaOk && priceOk !== false) return yes("exact+area+price");
    if (areaOk && t >= 0.6) return yes("exact+area+title");
    if (areaOk === null && priceOk && t >= 0.5) return yes("exact+price+title");
    return no("exact_but_different");
  }
  if (geo === "near_approx") {
    if (areaOk && priceOk && (t >= 0.5 || sameSeller)) return yes("approx+area+price+evidence");
    if (areaOk && t >= 0.75) return yes("approx+area+strong_title");
    return no("approx_insufficient");
  }
  // geo unknown (e.g. Otodom before enrichment)
  if (areaOk && priceOk && t >= 0.6 && sameCity(a.city, b.city)) return yes("unknown+area+price+title+city");
  return no("unknown_insufficient");
}
