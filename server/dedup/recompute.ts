import { asc, eq } from "drizzle-orm";
import type { PropertyLink } from "../../shared/schemas";
import type { Db } from "../db/client";
import { listings, properties, type ListingRow, type PropertyRow } from "../db/schema";
import { pricePerM2 } from "../sources/parse-utils";

const recency = (r: ListingRow) => (r.sourceRefreshedAt ?? r.lastSeenAt).getTime();
const byRecencyDesc = (a: ListingRow, b: ListingRow) => recency(b) - recency(a);

export interface PropertyAggregate {
  kind: ListingRow["kind"];
  lat: number | null;
  lon: number | null;
  locationPrecision: ListingRow["locationPrecision"];
  locationRadiusKm: number | null;
  areaM2: number | null;
  plotAreaM2: number | null;
  price: number | null;
  priceMin: number | null;
  priceMax: number | null;
  pricePerM2: number | null;
  title: string;
  city: string | null;
  district: string | null;
  isPrivate: boolean | null;
  sources: string[];
  primaryUrl: string;
  links: PropertyLink[];
  listingCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  isActive: boolean;
  ignored: boolean;
}

/** Derives the canonical property fields from its listings (pure). */
export function aggregateListings(rows: ListingRow[]): PropertyAggregate {
  if (rows.length === 0) throw new Error("aggregateListings needs at least one listing");
  // Ignored listings only count when nothing else is left (then the whole property is ignored).
  const ignored = rows.every((r) => r.ignored);
  const pool = ignored ? rows : rows.filter((r) => !r.ignored);
  const active = pool.filter((r) => r.isActive);
  const base = (active.length ? active : pool).slice().sort(byRecencyDesc);
  const best = base
    .slice()
    .sort((a, b) => Number(b.isPrivate === true) - Number(a.isPrivate === true) || byRecencyDesc(a, b))[0]!;
  const located = base.filter((r) => r.lat !== null && r.lon !== null);
  const loc = located.find((r) => r.locationPrecision === "exact") ?? located[0] ?? null;
  const withArea = base.find((r) => r.areaM2 !== null) ?? null;
  const withPlot = base.find((r) => r.plotAreaM2 !== null) ?? null;
  const activePrices = (active.length ? active : pool).map((r) => r.price).filter((p): p is number => p !== null);
  const allPrices = pool.map((r) => r.price).filter((p): p is number => p !== null);
  const price = activePrices.length ? Math.min(...activePrices) : null;
  const sources = [...new Set(pool.map((r) => r.source))];
  const links: PropertyLink[] = pool
    .slice()
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || byRecencyDesc(a, b))
    .map((r) => ({ source: r.source, url: r.url, active: r.isActive }));
  const isPrivate = base.some((r) => r.isPrivate === true) ? true : base.some((r) => r.isPrivate === false) ? false : null;
  const areaM2 = withArea?.areaM2 ?? null;
  return {
    kind: best.kind,
    lat: loc?.lat ?? null,
    lon: loc?.lon ?? null,
    locationPrecision: loc?.locationPrecision ?? "unknown",
    locationRadiusKm: loc?.locationRadiusKm ?? null,
    areaM2,
    plotAreaM2: withPlot?.plotAreaM2 ?? null,
    price,
    priceMin: allPrices.length ? Math.min(...allPrices) : null,
    priceMax: allPrices.length ? Math.max(...allPrices) : null,
    pricePerM2: pricePerM2(price, areaM2),
    title: best.title,
    city: best.city ?? base.find((r) => r.city)?.city ?? null,
    district: best.district ?? base.find((r) => r.district)?.district ?? null,
    isPrivate,
    sources,
    primaryUrl: best.url,
    links,
    listingCount: rows.length,
    firstSeenAt: new Date(Math.min(...rows.map((r) => r.firstSeenAt.getTime()))),
    lastSeenAt: new Date(Math.max(...rows.map((r) => r.lastSeenAt.getTime()))),
    isActive: active.length > 0,
    ignored,
  };
}

/** Recomputes a property from its listings; deletes it when no listings remain. Returns the updated row or null. */
export async function recomputeProperty(db: Db, propertyId: number, now: Date = new Date()): Promise<PropertyRow | null> {
  const rows = await db.select().from(listings).where(eq(listings.propertyId, propertyId)).orderBy(asc(listings.id));
  if (rows.length === 0) {
    await db.delete(properties).where(eq(properties.id, propertyId));
    return null;
  }
  const agg = aggregateListings(rows);
  const [updated] = await db
    .update(properties)
    .set({ ...agg, updatedAt: now })
    .where(eq(properties.id, propertyId))
    .returning();
  return updated ?? null;
}
