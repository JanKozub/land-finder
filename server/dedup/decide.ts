import type { Kind } from "../../shared/constants";
import { haversineKm } from "../../shared/geo";
import type { LocationPrecision } from "../../shared/schemas";
import { sameSellerTokens } from "./normalize";
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
  /** Portal-specific seller id (same portal only). */
  advertiserKey: string | null;
  /** Agency-name identity tokens, comparable across portals (see sellerTokens). */
  sellerTokens?: readonly string[];
  /** Cross-portal identity keys of the advertisement itself (see dedupKeysFor). */
  keys?: readonly string[];
  city: string | null;
}

export interface Decision {
  match: boolean;
  reason: string;
  score: number;
}

export const AREA_TOLERANCE = 0.03;
export const HOUSE_AREA_TOLERANCE = 0.05;
/** Houses: "total" vs "usable" area differ between portals; accepted only with the same seller and price. */
export const HOUSE_AREA_LOOSE_TOLERANCE = 0.2;
export const PRICE_TOLERANCE = 0.03;
export const EXACT_DISTANCE_KM = 0.15;
/** Two hand-placed "exact" pins of the same offer on different portals rarely coincide; up to this far they may still match with evidence. */
export const EXACT_NEAR_DISTANCE_KM = 1;
export const APPROX_MIN_DISTANCE_KM = 2;
/** Shared identity keys are decisive unless the coordinates say the ads are clearly elsewhere. */
export const IDENTITY_MAX_DISTANCE_KM = 5;
/** Pins this close are the same point: with identical price and area that is the same offer, whatever the titles say. */
export const SAME_POINT_KM = 0.1;

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

function sharedKey(a: readonly string[] | undefined, b: readonly string[] | undefined): string | null {
  if (!a?.length || !b?.length) return null;
  const set = new Set(b);
  return a.find((k) => set.has(k)) ?? null;
}

/** Pure matching rule: do two listings describe the same property? */
export function decide(a: DedupCandidate, b: DedupCandidate): Decision {
  const no = (reason: string): Decision => ({ match: false, reason, score: 0 });
  if (a.kind !== b.kind) return no("kind");

  const located = a.lat !== null && a.lon !== null && b.lat !== null && b.lon !== null;
  const dist = located ? haversineKm(a.lat!, a.lon!, b.lat!, b.lon!) : 0;

  // The same advertisement on another portal of the same platform / with the same agency reference.
  const key = sharedKey(a.keys, b.keys);
  if (key) {
    if (located && dist > IDENTITY_MAX_DISTANCE_KM) return no("identity_key_far");
    return { match: true, reason: `identity:${key.split(":")[0]}`, score: 5 - Math.min(dist, 5) / 10 };
  }

  const sameSeller =
    Boolean(a.advertiserKey && b.advertiserKey && a.advertiserKey === b.advertiserKey) || sameSellerTokens(a.sellerTokens ?? [], b.sellerTokens ?? []);
  const priceOk = tri(a.price, b.price, PRICE_TOLERANCE);
  const areaTol = a.kind === "house" ? HOUSE_AREA_TOLERANCE : AREA_TOLERANCE;
  let areaOk = tri(a.areaM2, b.areaM2, areaTol);
  let areaLoose = false;
  const titleEarly = titleSimilarity(a.titleNorm, b.titleNorm) ?? 0;
  if (areaOk === false) {
    // Portals disagree on "usable" vs "total" house area; the same seller (or the same headline) at the same price is still the same house.
    const loose = a.kind === "house" && priceOk === true && (sameSeller || titleEarly >= 0.6) && tri(a.areaM2, b.areaM2, HOUSE_AREA_LOOSE_TOLERANCE) === true;
    if (!loose) return no("area");
    areaOk = true;
    areaLoose = true;
  }
  const bothExact = located && a.locationPrecision === "exact" && b.locationPrecision === "exact";
  // Plot sizes of houses are entered inconsistently; two exact pins on the same spot with the same house and price
  // outweigh them, otherwise a differing plot is what tells neighbouring developer houses apart.
  const plotOk = a.kind === "house" ? tri(a.plotAreaM2, b.plotAreaM2, HOUSE_AREA_TOLERANCE) : null;
  if (plotOk === false && !(areaLoose || (bothExact && dist <= EXACT_DISTANCE_KM && priceOk === true && areaOk === true))) return no("plot_area");

  let geo: "unknown" | "same_exact" | "near_approx" | "far";
  if (!located) geo = "unknown";
  else if (bothExact) geo = dist <= EXACT_DISTANCE_KM ? "same_exact" : dist <= EXACT_NEAR_DISTANCE_KM ? "near_approx" : "far";
  else {
    const limit = Math.max(a.locationRadiusKm ?? 0, b.locationRadiusKm ?? 0, APPROX_MIN_DISTANCE_KM);
    geo = dist <= limit ? "near_approx" : "far";
  }
  if (geo === "far") return no("far");

  const t = titleEarly;
  // Identical price and (within 1 %) identical area: the same offer copied to another portal.
  const exactFigures = priceOk === true && a.price === b.price && tri(a.areaM2, b.areaM2, 0.01) === true;
  const samePoint = located && dist <= SAME_POINT_KM;
  const suffix = areaLoose ? "+area_loose" : "";
  const yes = (reason: string): Decision => ({
    match: true,
    reason: reason + suffix,
    score: 1 + t + (priceOk ? 0.5 : 0) + (sameSeller ? 0.25 : 0) - Math.min(dist, 10) / 10 - (areaLoose ? 0.3 : 0),
  });

  // The same pin (one portal's geocode copied to another) with the same figures: titles are often generated by the portal.
  if (samePoint && exactFigures && areaOk) return yes("same_point+figures");

  if (geo === "same_exact") {
    if (areaOk && priceOk !== false) return yes("exact+area+price");
    if (areaOk && t >= 0.6) return yes("exact+area+title");
    if (areaOk === null && priceOk && t >= 0.5) return yes("exact+price+title");
    return no("exact_but_different");
  }
  if (geo === "near_approx") {
    if (areaOk && priceOk && (t >= 0.5 || sameSeller || (exactFigures && t >= 0.3))) return yes("approx+area+price+evidence");
    if (areaOk && t >= 0.75) return yes("approx+area+strong_title");
    return no("approx_insufficient");
  }
  // geo unknown (e.g. Otodom before enrichment)
  if (areaOk && priceOk && sameCity(a.city, b.city) && (t >= 0.6 || (sameSeller && t >= 0.3))) return yes("unknown+area+price+title+city");
  return no("unknown_insufficient");
}
