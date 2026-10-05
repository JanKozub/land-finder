import { and, between, eq, gt, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { bboxAround } from "../../shared/geo";
import type { Db } from "../db/client";
import { listings, properties, type ListingRow } from "../db/schema";
import { decide, type DedupCandidate } from "./decide";
import { dedupKeysFor, normalizeAdvertiser, sellerTokens } from "./normalize";
import { aggregateListings, recomputeProperty } from "./recompute";

const CANDIDATE_BBOX_KM = 10;
const INACTIVE_GRACE_DAYS = 180;
const CANDIDATE_LIMIT = 300;

/** What `decide` looks at; whole rows carry attributes and descriptions that only slow the candidate queries down. */
const candidateColumns = {
  id: listings.id,
  propertyId: listings.propertyId,
  kind: listings.kind,
  lat: listings.lat,
  lon: listings.lon,
  locationPrecision: listings.locationPrecision,
  locationRadiusKm: listings.locationRadiusKm,
  areaM2: listings.areaM2,
  plotAreaM2: listings.plotAreaM2,
  price: listings.price,
  titleNorm: listings.titleNorm,
  advertiserName: listings.advertiserName,
  advertiserId: listings.advertiserId,
  city: listings.city,
  // the fields identity keys are derived from (see dedupKeysFor)
  internalId: sql<string | null>`${listings.attributes}->>'internalId'`,
  externalId: sql<string | null>`${listings.attributes}->>'externalId'`,
  offerNumber: sql<string | null>`${listings.attributes}->>'offerNumber'`,
};

type CandidateFields = Pick<
  ListingRow,
  "kind" | "lat" | "lon" | "locationPrecision" | "locationRadiusKm" | "areaM2" | "plotAreaM2" | "price" | "titleNorm" | "advertiserName" | "advertiserId" | "city"
>;
type CandidateRow = CandidateFields & { id: number; propertyId: number | null; internalId: string | null; externalId: string | null; offerNumber: string | null };

export function toCandidate(row: CandidateFields & { attributes: Record<string, unknown> }): DedupCandidate {
  return {
    kind: row.kind,
    lat: row.lat,
    lon: row.lon,
    locationPrecision: row.locationPrecision,
    locationRadiusKm: row.locationRadiusKm,
    areaM2: row.areaM2,
    plotAreaM2: row.plotAreaM2,
    price: row.price,
    titleNorm: row.titleNorm,
    advertiserKey: normalizeAdvertiser(row.advertiserName, row.advertiserId),
    sellerTokens: sellerTokens(row.advertiserName),
    keys: dedupKeysFor(row.attributes),
    city: row.city,
  };
}

export interface AssignOptions {
  suppressNotifications?: boolean;
  now?: Date;
}

export interface AssignResult {
  propertyId: number | null;
  created: boolean;
  matchedListingId: number | null;
  reason: string;
}

export async function createPropertyFromListing(db: Db, row: ListingRow, opts: AssignOptions = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const agg = aggregateListings([row]);
  const [created] = await db
    .insert(properties)
    .values({ ...agg, notifiedAt: opts.suppressNotifications ? now : null, createdAt: now, updatedAt: now })
    .returning({ id: properties.id });
  await db.update(listings).set({ propertyId: created!.id, updatedAt: now }).where(eq(listings.id, row.id));
  return created!.id;
}

async function findCandidates(db: Db, L: ListingRow, now: Date): Promise<CandidateRow[]> {
  /** Guards every candidate query shares: assigned, same kind, active or recently deactivated, not split by the user. */
  const baseConds = [
    ne(listings.id, L.id),
    eq(listings.kind, L.kind),
    isNotNull(listings.propertyId),
    or(eq(listings.isActive, true), gt(listings.deactivatedAt, new Date(now.getTime() - INACTIVE_GRACE_DAYS * 86_400_000)))!,
    sql`NOT EXISTS (SELECT 1 FROM dedup_exclusions e WHERE e.listing_id_a = LEAST(${L.id}::bigint, ${listings.id}) AND e.listing_id_b = GREATEST(${L.id}::bigint, ${listings.id}))`,
  ];
  const conds = [...baseConds];
  if (L.lat !== null && L.lon !== null) {
    const box = bboxAround(L.lat, L.lon, CANDIDATE_BBOX_KM);
    const sameCity = L.city ? sql`lower(${listings.city}) = lower(${L.city})` : sql`false`;
    conds.push(
      or(
        and(isNull(listings.lat), sameCity),
        and(between(listings.lat, box.minLat, box.maxLat), between(listings.lon, box.minLon, box.maxLon)),
      )!,
    );
  } else if (L.city) {
    conds.push(sql`lower(${listings.city}) = lower(${L.city})`);
  } else {
    return [];
  }
  if (L.areaM2 !== null) {
    const spread = L.kind === "house" ? 0.25 : 0.06;
    conds.push(or(isNull(listings.areaM2), between(listings.areaM2, L.areaM2 * (1 - spread), L.areaM2 * (1 + spread)))!);
  }
  const rows: CandidateRow[] = await db.select(candidateColumns).from(listings).where(and(...conds)).limit(CANDIDATE_LIMIT);

  // Listings sharing an identity key (same platform id, same agency reference) regardless of location/area.
  // The same guards as above apply: a pair the user split by hand stays apart whatever keys it shares.
  const keys = dedupKeysFor(L.attributes);
  if (keys.length) {
    const byKey = await db
      .select(candidateColumns)
      .from(listings)
      .where(and(...baseConds, sql`${listings.attributes}->'dedupKeys' ?| array[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]`))
      .limit(50);
    const seen = new Set(rows.map((r) => r.id));
    for (const r of byKey) if (!seen.has(r.id)) rows.push(r);
  }
  return rows;
}

/**
 * Attaches the listing to an existing property when the dedup rules say it is the same offer,
 * otherwise creates a new property. Pinned listings keep their assignment.
 */
export async function assignProperty(db: Db, listingId: number, opts: AssignOptions = {}): Promise<AssignResult> {
  const now = opts.now ?? new Date();
  const [L] = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  if (!L) return { propertyId: null, created: false, matchedListingId: null, reason: "missing" };
  if (L.pinned && L.propertyId !== null) {
    await recomputeProperty(db, L.propertyId, now);
    return { propertyId: L.propertyId, created: false, matchedListingId: null, reason: "pinned" };
  }

  const me = toCandidate(L);
  const candidates = await findCandidates(db, L, now);
  const perProperty = new Map<number, { count: number; score: number; listingId: number; reason: string }>();
  for (const c of candidates) {
    const d = decide(me, toCandidate({ ...c, attributes: { internalId: c.internalId, externalId: c.externalId, offerNumber: c.offerNumber } }));
    if (!d.match || c.propertyId === null) continue;
    const cur = perProperty.get(c.propertyId);
    if (!cur) perProperty.set(c.propertyId, { count: 1, score: d.score, listingId: c.id, reason: d.reason });
    else {
      cur.count += 1;
      if (d.score > cur.score) {
        cur.score = d.score;
        cur.listingId = c.id;
        cur.reason = d.reason;
      }
    }
  }
  const ranked = [...perProperty.entries()].sort((a, b) => b[1].count - a[1].count || b[1].score - a[1].score);
  const previous = L.propertyId;
  const winner = ranked[0];

  if (!winner) {
    if (previous !== null) {
      const others = await db.select({ id: listings.id }).from(listings).where(and(eq(listings.propertyId, previous), ne(listings.id, L.id))).limit(1);
      if (others.length === 0) {
        // Still the only listing of its property: just refresh the aggregate.
        await recomputeProperty(db, previous, now);
        return { propertyId: previous, created: false, matchedListingId: null, reason: "solo" };
      }
    }
    const id = await createPropertyFromListing(db, L, { ...opts, now });
    if (previous !== null) await recomputeProperty(db, previous, now);
    return { propertyId: id, created: true, matchedListingId: null, reason: "new" };
  }

  const [targetId, info] = winner;
  if (previous !== targetId) {
    await db.update(listings).set({ propertyId: targetId, updatedAt: now }).where(eq(listings.id, L.id));
    if (previous !== null) await recomputeProperty(db, previous, now);
  }
  await recomputeProperty(db, targetId, now);
  return { propertyId: targetId, created: false, matchedListingId: info.listingId, reason: info.reason };
}
