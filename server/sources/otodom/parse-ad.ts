import type { LocationPrecision } from "../../../shared/schemas";
import { asNumber, asRecord, asString } from "../parse-utils";
import { pagePropsOf } from "./parse-list";

export interface OtodomAdData {
  lat: number | null;
  lon: number | null;
  locationPrecision: LocationPrecision;
  locationRadiusKm: number | null;
  status: string | null;
  areaM2: number | null;
  plotAreaM2: number | null;
  plotType: string | null;
  city: string | null;
  attributes: Record<string, unknown>;
}

const TARGET_KEYS = [
  "Build_year",
  "Building_type",
  "Construction_status",
  "Media_types",
  "Access_types",
  "MarketType",
  "Type",
  "Fence_types",
  "Vicinity_types",
  "Location",
  "Dimensions",
  "City",
  "Subregion",
  "Price_per_m",
] as const;

/** Returns null when the payload has no `ad` (e.g. the ad was removed and a 404 page was served). */
export function parseOtodomAd(data: unknown): OtodomAdData | null {
  const pageProps = pagePropsOf(data);
  const ad = asRecord(pageProps?.ad);
  if (!ad) return null;
  const location = asRecord(ad.location);
  const coords = asRecord(location?.coordinates);
  const mapDetails = asRecord(location?.mapDetails);
  const lat = coords ? asNumber(coords.latitude) : null;
  const lon = coords ? asNumber(coords.longitude) : null;
  const radius = mapDetails ? asNumber(mapDetails.radius) : null;
  const target = asRecord(ad.target) ?? {};
  const attributes: Record<string, unknown> = {};
  for (const key of TARGET_KEYS) {
    if (target[key] !== undefined && target[key] !== null && target[key] !== "") attributes[key] = target[key];
  }
  const typeRaw = target.Type;
  const plotType = Array.isArray(typeRaw) ? asString(typeRaw[0]) : asString(typeRaw);
  const hasCoords = lat !== null && lon !== null;
  return {
    lat: hasCoords ? lat : null,
    lon: hasCoords ? lon : null,
    locationPrecision: hasCoords ? (radius === 0 ? "exact" : "approx") : "unknown",
    locationRadiusKm: hasCoords ? radius : null,
    status: asString(ad.status),
    areaM2: asNumber(target.Area),
    plotAreaM2: asNumber(target.Terrain_area),
    plotType,
    city: asString(target.City),
    attributes: {
      ...attributes,
      externalId: asString(ad.externalId),
      advertiserType: asString(ad.advertiserType),
      modifiedAt: asString(ad.modifiedAt),
    },
  };
}
