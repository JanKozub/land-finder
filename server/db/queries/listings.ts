import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { areaContains } from "../../../shared/area";
import type { Kind, Source } from "../../../shared/constants";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { ListingSortKey, ListingsQuery } from "../../../shared/schemas";
import { normalizeTitle, withDedupKeys } from "../../dedup/normalize";
import type { NormalizedListing } from "../../sources/types";
import type { Db } from "../client";
import { listings, priceHistory, properties, type ListingRow, type NewListingRow } from "../schema";

export interface UpsertResult {
  id: number;
  sourceId: string;
  inserted: boolean;
  changed: boolean;
  /** Something dedup looks at changed (price, title, area, coordinates, advertiser, reactivation), or it was never assigned. */
  needsAssignment: boolean;
  priceChanged: boolean;
  previousPrice: number | null;
  price: number | null;
  hasCoords: boolean;
  propertyId: number | null;
}

function toInsertRow(item: NormalizedListing, now: Date): NewListingRow {
  return {
    source: item.source,
    sourceId: item.sourceId,
    url: item.url,
    title: item.title,
    titleNorm: normalizeTitle(item.title),
    kind: item.kind,
    price: item.price,
    priceNegotiable: item.priceNegotiable,
    pricePerM2: item.pricePerM2,
    areaM2: item.areaM2,
    plotAreaM2: item.plotAreaM2,
    rooms: item.rooms,
    plotType: item.plotType,
    lat: item.lat,
    lon: item.lon,
    locationPrecision: item.locationPrecision,
    locationRadiusKm: item.locationRadiusKm,
    city: item.city,
    district: item.district,
    region: item.region,
    isPrivate: item.isPrivate,
    advertiserName: item.advertiserName,
    advertiserId: item.advertiserId,
    attributes: withDedupKeys(item.attributes),
    descriptionExcerpt: item.descriptionExcerpt,
    sourceCreatedAt: item.sourceCreatedAt,
    sourceRefreshedAt: item.sourceRefreshedAt,
    validTo: item.validTo,
    firstSeenAt: now,
    lastSeenAt: now,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

const UPDATE_CONCURRENCY = 6;

/** Inserts new listings and refreshes known ones (by source + source id). Reports what changed. */
export async function upsertListings(db: Db, items: NormalizedListing[], now: Date): Promise<UpsertResult[]> {
  if (items.length === 0) return [];
  const source = items[0]!.source;
  const ids = [...new Set(items.map((i) => i.sourceId))];
  const existingRows = await db
    .select()
    .from(listings)
    .where(and(eq(listings.source, source), inArray(listings.sourceId, ids)));
  const existing = new Map(existingRows.map((r) => [r.sourceId, r]));
  const results: UpsertResult[] = [];

  const toInsert = items.filter((i) => !existing.has(i.sourceId));
  // Deduplicate within the batch (promoted ads may repeat).
  const seen = new Set<string>();
  const insertRows = toInsert.filter((i) => (seen.has(i.sourceId) ? false : (seen.add(i.sourceId), true))).map((i) => toInsertRow(i, now));
  if (insertRows.length) {
    const inserted = await db.insert(listings).values(insertRows).onConflictDoNothing().returning();
    for (const row of inserted) {
      results.push({
        id: row.id,
        sourceId: row.sourceId,
        inserted: true,
        changed: true,
        needsAssignment: true,
        priceChanged: false,
        previousPrice: null,
        price: row.price,
        hasCoords: row.lat !== null && row.lon !== null,
        propertyId: null,
      });
    }
  }

  const updates: Array<() => Promise<void>> = [];
  for (const item of items) {
    const row = existing.get(item.sourceId);
    if (!row) continue;
    const priceChanged = (row.price ?? null) !== (item.price ?? null);
    const refreshed = (item.sourceRefreshedAt?.getTime() ?? 0) > (row.sourceRefreshedAt?.getTime() ?? 0);
    const newCoords = item.lat !== null && item.lon !== null && (item.lat !== row.lat || item.lon !== row.lon);
    const relevant =
      priceChanged ||
      !row.isActive ||
      row.title !== item.title ||
      (row.areaM2 ?? null) !== (item.areaM2 ?? null) ||
      newCoords ||
      (item.advertiserId !== null && item.advertiserId !== row.advertiserId);
    // A bump (newer refresh time) refreshes the stored fields but is no reason to run dedup again.
    const changed = relevant || refreshed;
    const patch: Partial<NewListingRow> = {
      lastSeenAt: now,
      isActive: true,
      deactivatedAt: null,
      updatedAt: now,
    };
    if (changed) {
      Object.assign(patch, {
        title: item.title,
        titleNorm: normalizeTitle(item.title),
        price: item.price,
        priceNegotiable: item.priceNegotiable,
        pricePerM2: item.pricePerM2,
        areaM2: item.areaM2 ?? row.areaM2,
        plotAreaM2: item.plotAreaM2 ?? row.plotAreaM2,
        rooms: item.rooms ?? row.rooms,
        plotType: item.plotType ?? row.plotType,
        city: item.city ?? row.city,
        district: item.district ?? row.district,
        region: item.region ?? row.region,
        isPrivate: item.isPrivate ?? row.isPrivate,
        advertiserName: item.advertiserName ?? row.advertiserName,
        advertiserId: item.advertiserId ?? row.advertiserId,
        attributes: withDedupKeys({ ...row.attributes, ...item.attributes }),
        descriptionExcerpt: item.descriptionExcerpt ?? row.descriptionExcerpt,
        sourceRefreshedAt: item.sourceRefreshedAt ?? row.sourceRefreshedAt,
        validTo: item.validTo ?? row.validTo,
      });
      if (item.lat !== null && item.lon !== null) {
        Object.assign(patch, {
          lat: item.lat,
          lon: item.lon,
          locationPrecision: item.locationPrecision,
          locationRadiusKm: item.locationRadiusKm,
        });
      }
    }
    updates.push(async () => {
      await db.update(listings).set(patch).where(eq(listings.id, row.id));
    });
    results.push({
      id: row.id,
      sourceId: row.sourceId,
      inserted: false,
      changed,
      needsAssignment: relevant || row.propertyId === null,
      priceChanged,
      previousPrice: row.price,
      price: item.price,
      hasCoords: (item.lat !== null && item.lon !== null) || (row.lat !== null && row.lon !== null),
      propertyId: row.propertyId,
    });
  }
  // Distinct rows; a few at a time keeps a remote database from being paid one round trip per listing in sequence.
  for (let i = 0; i < updates.length; i += UPDATE_CONCURRENCY) {
    await Promise.all(updates.slice(i, i + UPDATE_CONCURRENCY).map((fn) => fn()));
  }
  return results;
}

export async function addPriceHistory(db: Db, entries: { listingId: number; price: number; observedAt: Date }[]): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(priceHistory).values(entries);
}

export async function priceHistoryForListings(db: Db, listingIds: number[]) {
  if (listingIds.length === 0) return [];
  return db
    .select()
    .from(priceHistory)
    .where(inArray(priceHistory.listingId, listingIds))
    .orderBy(desc(priceHistory.observedAt));
}

export async function getListingById(db: Db, id: number): Promise<ListingRow | null> {
  const [row] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  return row ?? null;
}

export async function listingsForProperty(db: Db, propertyId: number): Promise<ListingRow[]> {
  return db.select().from(listings).where(eq(listings.propertyId, propertyId)).orderBy(desc(listings.isActive), desc(listings.lastSeenAt));
}

/** Marks listings of a source/kind that were not seen since `since` as inactive. Returns affected rows. */
export async function deactivateUnseen(db: Db, source: Source, kind: Kind, since: Date, now: Date) {
  return db
    .update(listings)
    .set({ isActive: false, deactivatedAt: now, updatedAt: now })
    .where(and(eq(listings.source, source), eq(listings.kind, kind), eq(listings.isActive, true), lt(listings.lastSeenAt, since)))
    .returning({ id: listings.id, propertyId: listings.propertyId });
}

/** OLX ads carry an expiry date; past it they are gone without any request. */
export async function expireByValidTo(db: Db, now: Date) {
  return db
    .update(listings)
    .set({ isActive: false, deactivatedAt: now, updatedAt: now })
    .where(and(eq(listings.isActive, true), lt(listings.validTo, now)))
    .returning({ id: listings.id, propertyId: listings.propertyId });
}

export const MAX_ENRICH_ATTEMPTS = 3;

export async function listingsNeedingEnrichment(db: Db, source: Source, limit: number): Promise<ListingRow[]> {
  return db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.source, source),
        isNull(listings.lat),
        eq(listings.isActive, true),
        isNull(listings.enrichedAt),
        sql`${listings.enrichAttempts} < ${MAX_ENRICH_ATTEMPTS}`,
      ),
    )
    .orderBy(desc(listings.firstSeenAt))
    .limit(limit);
}

export async function applyEnrichment(
  db: Db,
  id: number,
  patch: Partial<NormalizedListing> & { isActive?: boolean },
  now: Date,
  succeeded: boolean,
): Promise<ListingRow | null> {
  const set: Partial<NewListingRow> = { updatedAt: now, enrichAttempts: sql`${listings.enrichAttempts} + 1` as unknown as number };
  if (succeeded) set.enrichedAt = now;
  if (patch.lat !== undefined) set.lat = patch.lat;
  if (patch.lon !== undefined) set.lon = patch.lon;
  if (patch.locationPrecision !== undefined) set.locationPrecision = patch.locationPrecision;
  if (patch.locationRadiusKm !== undefined) set.locationRadiusKm = patch.locationRadiusKm;
  if (patch.areaM2 !== undefined) set.areaM2 = patch.areaM2;
  if (patch.plotAreaM2 !== undefined) set.plotAreaM2 = patch.plotAreaM2;
  if (patch.plotType !== undefined) set.plotType = patch.plotType;
  if (patch.city !== undefined) set.city = patch.city;
  if (patch.attributes !== undefined) set.attributes = withDedupKeys(patch.attributes);
  if (patch.isActive === false) {
    set.isActive = false;
    set.deactivatedAt = now;
  }
  const [row] = await db.update(listings).set(set).where(eq(listings.id, id)).returning();
  return row ?? null;
}

/** Removes a listing for good (its property is recomputed or dropped by the caller via recomputeProperties). */
export async function deleteListing(db: Db, id: number, now: Date): Promise<number | null> {
  const [row] = await db.delete(listings).where(eq(listings.id, id)).returning({ propertyId: listings.propertyId });
  if (!row) return null;
  if (row.propertyId !== null) {
    const { recomputeProperty } = await import("../../dedup/recompute");
    await recomputeProperty(db, row.propertyId, now);
  }
  return row.propertyId;
}

/** Ids of located listings whose coordinates fall outside the rectangle (with the same slack the ingestion uses). */
export async function listingIdsOutsideArea(db: Db, area: { south: number; west: number; north: number; east: number }): Promise<number[]> {
  const rows = await db
    .select({ id: listings.id, lat: listings.lat, lon: listings.lon, radius: listings.locationRadiusKm })
    .from(listings)
    .where(and(isNotNull(listings.lat), isNotNull(listings.lon)));
  return rows.filter((r) => !areaContains(area, r.lat!, r.lon!, Math.max(1, r.radius ?? 0))).map((r) => r.id);
}

export async function listingsBySourceKind(db: Db): Promise<Record<string, Partial<Record<Kind, number>>>> {
  const rows = await db
    .select({ source: listings.source, kind: listings.kind, n: sql<number>`count(*)::int` })
    .from(listings)
    .where(eq(listings.isActive, true))
    .groupBy(listings.source, listings.kind);
  const out: Record<string, Partial<Record<Kind, number>>> = {};
  for (const r of rows) (out[r.source] ??= {})[r.kind] = r.n;
  return out;
}

export async function countListings(db: Db): Promise<{ total: number; active: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${listings.isActive})::int`,
    })
    .from(listings);
  return { total: row?.total ?? 0, active: row?.active ?? 0 };
}

const SORT_COLUMNS: Record<ListingSortKey, AnyPgColumn> = {
  firstSeenAt: listings.firstSeenAt,
  sourceCreatedAt: listings.sourceCreatedAt,
  lastSeenAt: listings.lastSeenAt,
  price: listings.price,
  pricePerM2: listings.pricePerM2,
  areaM2: listings.areaM2,
  plotAreaM2: listings.plotAreaM2,
  title: listings.title,
  city: listings.city,
  source: listings.source,
  kind: listings.kind,
};

export type ListingTableRow = ListingRow & { propertyHidden: boolean };

/** WHERE clause of the offers table filter (shared by the paginated view and bulk actions). */
export function listingsTableWhere(query: ListingsQuery): SQL | undefined {
  const conds: SQL[] = [];
  if (query.q) {
    const like = `%${query.q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(listings.title, like), ilike(listings.city, like), ilike(listings.district, like), eq(listings.sourceId, query.q))!);
  }
  if (query.source) conds.push(eq(listings.source, query.source));
  if (query.kind) conds.push(eq(listings.kind, query.kind));
  if (query.status === "active") conds.push(eq(listings.isActive, true));
  if (query.status === "inactive") conds.push(eq(listings.isActive, false));
  if (query.ignored === "hide") conds.push(eq(listings.ignored, false));
  if (query.ignored === "only") conds.push(eq(listings.ignored, true));
  if (query.priceMin !== undefined) conds.push(gte(listings.price, query.priceMin));
  if (query.priceMax !== undefined) conds.push(lte(listings.price, query.priceMax));
  if (query.areaMin !== undefined) conds.push(gte(listings.areaM2, query.areaMin));
  if (query.areaMax !== undefined) conds.push(lte(listings.areaM2, query.areaMax));
  if (query.pricePerM2Max !== undefined) conds.push(lte(listings.pricePerM2, query.pricePerM2Max));
  return conds.length ? and(...conds) : undefined;
}

/** Paginated, sortable view of every listing in the database (the "all offers" table). */
export async function listListingsTable(db: Db, query: ListingsQuery): Promise<{ rows: ListingTableRow[]; total: number }> {
  const where = listingsTableWhere(query);

  const column = SORT_COLUMNS[query.sort];
  const order = query.dir === "asc" ? sql`${column} asc nulls last` : sql`${column} desc nulls last`;
  const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(listings).where(where);
  const rows = await db
    .select({ listing: listings, propertyHidden: properties.hidden })
    .from(listings)
    .leftJoin(properties, eq(listings.propertyId, properties.id))
    .where(where)
    .orderBy(order, desc(listings.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return { rows: rows.map((r) => ({ ...r.listing, propertyHidden: r.propertyHidden ?? false })), total: countRow?.n ?? 0 };
}

/**
 * Flags every listing matching the table filter as ignored (or restores it). Only rows whose flag changes are
 * touched; the caller recomputes the returned properties so the map reflects the change.
 */
export async function bulkSetListingsIgnored(
  db: Db,
  query: ListingsQuery,
  ignored: boolean,
  now: Date,
): Promise<{ listingIds: number[]; propertyIds: number[] }> {
  const rows = await db
    .update(listings)
    .set({ ignored, ignoredAt: ignored ? now : null, updatedAt: now })
    .where(and(listingsTableWhere(query), eq(listings.ignored, !ignored)))
    .returning({ id: listings.id, propertyId: listings.propertyId });
  const propertyIds = [...new Set(rows.map((r) => r.propertyId).filter((id): id is number => id !== null))];
  return { listingIds: rows.map((r) => r.id), propertyIds };
}
