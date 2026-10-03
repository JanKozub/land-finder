import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { ListingDto, PropertyDetailDto, PropertyDto, Settings } from "../../../shared/schemas";
import { createPropertyFromListing } from "../../dedup/match";
import { recomputeProperty } from "../../dedup/recompute";
import { propertyWhere } from "../../filters/where";
import type { Filters } from "../../../shared/schemas";
import type { Db } from "../client";
import { dedupExclusions, listings, properties, type ListingRow, type PropertyRow } from "../schema";
import { listingsForProperty, priceHistoryForListings } from "./listings";

const PROPERTY_LIMIT = 5000;

export function propertyToDto(row: PropertyRow): PropertyDto {
  return {
    id: row.id,
    kind: row.kind,
    lat: row.lat,
    lon: row.lon,
    locationPrecision: row.locationPrecision,
    areaM2: row.areaM2,
    plotAreaM2: row.plotAreaM2,
    price: row.price,
    priceMin: row.priceMin,
    priceMax: row.priceMax,
    pricePerM2: row.pricePerM2,
    title: row.title,
    city: row.city,
    district: row.district,
    isPrivate: row.isPrivate,
    sources: row.sources,
    url: row.primaryUrl,
    links: row.links,
    listingCount: row.listingCount,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    isActive: row.isActive,
    hidden: row.hidden,
    ignored: row.ignored,
    favorite: row.favorite,
    note: row.note,
  };
}

export function listingToDto(row: ListingRow, history: { price: number; observedAt: Date }[]): ListingDto {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.sourceId,
    kind: row.kind,
    url: row.url,
    title: row.title,
    price: row.price,
    priceNegotiable: row.priceNegotiable,
    areaM2: row.areaM2,
    plotAreaM2: row.plotAreaM2,
    pricePerM2: row.pricePerM2,
    plotType: row.plotType,
    rooms: row.rooms,
    lat: row.lat,
    lon: row.lon,
    locationPrecision: row.locationPrecision,
    city: row.city,
    district: row.district,
    isPrivate: row.isPrivate,
    advertiserName: row.advertiserName,
    descriptionExcerpt: row.descriptionExcerpt,
    attributes: row.attributes,
    sourceCreatedAt: row.sourceCreatedAt?.toISOString() ?? null,
    sourceRefreshedAt: row.sourceRefreshedAt?.toISOString() ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    isActive: row.isActive,
    ignored: row.ignored,
    ignoredAt: row.ignoredAt?.toISOString() ?? null,
    pinned: row.pinned,
    priceHistory: history.map((h) => ({ price: h.price, observedAt: h.observedAt.toISOString() })),
  };
}

export async function listProperties(db: Db, filters: Filters, settings: Settings, now = new Date()): Promise<PropertyDto[]> {
  const where = propertyWhere(filters, settings.center, now);
  const rows = await db.select().from(properties).where(where).orderBy(desc(properties.firstSeenAt)).limit(PROPERTY_LIMIT);
  return rows.map(propertyToDto);
}

export async function getProperty(db: Db, id: number): Promise<PropertyRow | null> {
  const [row] = await db.select().from(properties).where(eq(properties.id, id)).limit(1);
  return row ?? null;
}

export async function getPropertyDetail(db: Db, id: number): Promise<PropertyDetailDto | null> {
  const row = await getProperty(db, id);
  if (!row) return null;
  const rows = await listingsForProperty(db, id);
  const history = await priceHistoryForListings(db, rows.map((r) => r.id));
  const byListing = new Map<number, { price: number; observedAt: Date }[]>();
  for (const h of history) {
    const arr = byListing.get(h.listingId) ?? [];
    arr.push({ price: h.price, observedAt: h.observedAt });
    byListing.set(h.listingId, arr);
  }
  return { ...propertyToDto(row), listings: rows.map((r) => listingToDto(r, byListing.get(r.id) ?? [])) };
}

export async function setHidden(db: Db, id: number, hidden: boolean, now = new Date()): Promise<PropertyRow | null> {
  const [row] = await db
    .update(properties)
    .set({ hidden, hiddenAt: hidden ? now : null, updatedAt: now })
    .where(eq(properties.id, id))
    .returning();
  return row ?? null;
}

export async function setFavorite(db: Db, id: number, favorite: boolean, now = new Date()): Promise<PropertyRow | null> {
  const [row] = await db
    .update(properties)
    .set({ favorite, favoriteAt: favorite ? now : null, updatedAt: now })
    .where(eq(properties.id, id))
    .returning();
  return row ?? null;
}

/** Ignores (or restores) every listing of a property at once. */
export async function setPropertyIgnored(db: Db, id: number, ignored: boolean, now = new Date()): Promise<PropertyRow | null> {
  const existing = await getProperty(db, id);
  if (!existing) return null;
  await db
    .update(listings)
    .set({ ignored, ignoredAt: ignored ? now : null, updatedAt: now })
    .where(eq(listings.propertyId, id));
  return recomputeProperty(db, id, now);
}

export async function setNote(db: Db, id: number, note: string | null, now = new Date()): Promise<PropertyRow | null> {
  const [row] = await db.update(properties).set({ note, updatedAt: now }).where(eq(properties.id, id)).returning();
  return row ?? null;
}

/** Moves all listings of `sourceId` into `targetId`, pins them, and removes the emptied property. */
export async function mergeProperties(db: Db, targetId: number, sourceId: number, now = new Date()): Promise<PropertyRow | null> {
  if (targetId === sourceId) return getProperty(db, targetId);
  const [target, source] = await Promise.all([getProperty(db, targetId), getProperty(db, sourceId)]);
  if (!target || !source) return null;
  await db.update(listings).set({ propertyId: targetId, pinned: true, updatedAt: now }).where(eq(listings.propertyId, sourceId));
  await db.update(listings).set({ pinned: true, updatedAt: now }).where(eq(listings.propertyId, targetId));
  await db
    .update(properties)
    .set({
      manual: true,
      hidden: target.hidden || source.hidden,
      favorite: target.favorite || source.favorite,
      favoriteAt: target.favoriteAt ?? source.favoriteAt,
      note: target.note ?? source.note,
      updatedAt: now,
    })
    .where(eq(properties.id, targetId));
  await recomputeProperty(db, sourceId, now); // deletes it (no listings left)
  return recomputeProperty(db, targetId, now);
}

/** Splits a listing into its own property and records exclusions so it is never auto-merged back. */
export async function detachListing(db: Db, listingId: number, now = new Date()): Promise<{ propertyId: number } | null> {
  const [L] = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  if (!L) return null;
  const oldPropertyId = L.propertyId;
  if (oldPropertyId !== null) {
    const siblings = await db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.propertyId, oldPropertyId), ne(listings.id, L.id)));
    if (siblings.length === 0) {
      await db.update(listings).set({ pinned: true, updatedAt: now }).where(eq(listings.id, L.id));
      await recomputeProperty(db, oldPropertyId, now);
      return { propertyId: oldPropertyId };
    }
    await db
      .insert(dedupExclusions)
      .values(
        siblings.map((s) => ({
          listingIdA: Math.min(s.id, L.id),
          listingIdB: Math.max(s.id, L.id),
          createdAt: now,
        })),
      )
      .onConflictDoNothing();
  }
  const newId = await createPropertyFromListing(db, L, { now });
  await db.update(listings).set({ pinned: true, updatedAt: now }).where(eq(listings.id, L.id));
  await db.update(properties).set({ manual: true, updatedAt: now }).where(eq(properties.id, newId));
  if (oldPropertyId !== null) await recomputeProperty(db, oldPropertyId, now);
  return { propertyId: newId };
}

/** Flags one listing as ignored (or restores it) and refreshes its property aggregate. */
export async function setListingIgnored(
  db: Db,
  listingId: number,
  ignored: boolean,
  now = new Date(),
): Promise<{ listing: ListingRow; property: PropertyRow | null } | null> {
  const [listing] = await db
    .update(listings)
    .set({ ignored, ignoredAt: ignored ? now : null, updatedAt: now })
    .where(eq(listings.id, listingId))
    .returning();
  if (!listing) return null;
  const property = listing.propertyId === null ? null : await recomputeProperty(db, listing.propertyId, now);
  return { listing, property };
}

export async function recomputeProperties(db: Db, ids: Iterable<number | null>, now = new Date()): Promise<void> {
  const unique = [...new Set([...ids].filter((v): v is number => v !== null))];
  for (const id of unique) await recomputeProperty(db, id, now);
}

export async function countProperties(db: Db): Promise<{ total: number; active: number; hidden: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${properties.isActive} and not ${properties.hidden})::int`,
      hidden: sql<number>`count(*) filter (where ${properties.hidden})::int`,
    })
    .from(properties);
  return { total: row?.total ?? 0, active: row?.active ?? 0, hidden: row?.hidden ?? 0 };
}

export async function propertiesByIds(db: Db, ids: number[]): Promise<PropertyRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(properties).where(inArray(properties.id, ids));
}
