import { and, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { KINDS, SOURCES } from "../../shared/constants";
import { FilterSchema, type Filters, type Settings } from "../../shared/schemas";
import { properties } from "../db/schema";

export interface Center {
  lat: number;
  lon: number;
}

export function haversineSql(lat: number, lon: number): SQL<number> {
  return sql<number>`6371 * acos(least(1.0, cos(radians(${lat})) * cos(radians(${properties.lat})) * cos(radians(${properties.lon}) - radians(${lon})) + sin(radians(${lat})) * sin(radians(${properties.lat}))))`;
}

/** Builds the WHERE clause for the properties table from UI filters (also reused for alerts). */
export function propertyWhere(f: Filters, center: Center, now: Date = new Date()): SQL | undefined {
  const conds: SQL[] = [];
  if (f.kinds.length > 0 && f.kinds.length < KINDS.length) conds.push(inArray(properties.kind, f.kinds));
  if (f.priceMin !== null) conds.push(gte(properties.price, f.priceMin));
  if (f.priceMax !== null) conds.push(lte(properties.price, f.priceMax));
  if (f.areaMin !== null) conds.push(gte(properties.areaM2, f.areaMin));
  if (f.areaMax !== null) conds.push(lte(properties.areaM2, f.areaMax));
  if (f.pricePerM2Max !== null) conds.push(lte(properties.pricePerM2, f.pricePerM2Max));
  if (f.sources.length > 0 && f.sources.length < SOURCES.length) {
    const arr = sql.join(f.sources.map((s) => sql`${s}`), sql`, `);
    conds.push(sql`${properties.sources} && ARRAY[${arr}]::text[]`);
  }
  if (f.owner === "private") conds.push(eq(properties.isPrivate, true));
  if (f.owner === "agency") conds.push(eq(properties.isPrivate, false));
  if (f.addedWithinDays !== null) conds.push(gte(properties.firstSeenAt, new Date(now.getTime() - f.addedWithinDays * 86_400_000)));
  if (f.distanceKm !== null) {
    conds.push(isNotNull(properties.lat));
    conds.push(sql`${haversineSql(center.lat, center.lon)} <= ${f.distanceKm}`);
  }
  if (f.hidden === "exclude") conds.push(eq(properties.hidden, false));
  if (f.hidden === "only") conds.push(eq(properties.hidden, true));
  if (f.ignored === "exclude") conds.push(eq(properties.ignored, false));
  if (f.ignored === "only") conds.push(eq(properties.ignored, true));
  if (f.favorites === "only") conds.push(eq(properties.favorite, true));
  if (f.active === "only") conds.push(eq(properties.isActive, true));
  return conds.length ? and(...conds) : undefined;
}

/** Alert criteria expressed as filters so notifications and the UI share one implementation. */
export function alertFilters(settings: Settings): Filters {
  const a = settings.alert;
  return FilterSchema.parse({
    kinds: a.kinds.length ? a.kinds : [...KINDS],
    priceMax: a.maxPrice,
    areaMin: a.minArea,
    pricePerM2Max: a.maxPricePerM2,
    owner: a.privateOnly ? "private" : "all",
    hidden: "exclude",
    ignored: "exclude",
    active: "only",
  });
}
