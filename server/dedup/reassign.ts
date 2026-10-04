import { asc, gt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { listings } from "../db/schema";
import { adapters, type AdapterRegistry } from "../sources";
import { assignProperty } from "./match";

export interface ReassignBatchResult {
  /** Listings looked at in this batch. */
  processed: number;
  /** Listings that ended up in a different property than before. */
  moved: number;
  /** Cursor for the next batch; null when every listing has been re-evaluated. */
  nextAfterId: number | null;
  /** Empty properties removed (only on the final batch). */
  removedProperties: number;
}

/**
 * Re-runs the matching rules over listings with id > afterId, in id order, until `limit` listings were handled or
 * the time budget is used up. Resumable: callers loop on `nextAfterId` (the UI does it in short HTTP calls, the
 * CLI in one go). Pinned listings and listings still waiting for their ad page are left alone, like the list job does.
 */
export async function reassignBatch(
  db: Db,
  opts: { afterId: number; limit?: number; budgetMs?: number; now?: Date; registry?: AdapterRegistry },
): Promise<ReassignBatchResult> {
  const started = Date.now();
  const limit = opts.limit ?? 100;
  const budgetMs = opts.budgetMs ?? Infinity;
  const now = opts.now ?? new Date();
  const registry = opts.registry ?? adapters;
  const rows = await db
    .select({ id: listings.id, propertyId: listings.propertyId, lat: listings.lat, city: listings.city, source: listings.source, enrichedAt: listings.enrichedAt, pinned: listings.pinned })
    .from(listings)
    .where(gt(listings.id, opts.afterId))
    .orderBy(asc(listings.id))
    .limit(limit + 1);
  const batch = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  let processed = 0;
  let moved = 0;
  let lastId = opts.afterId;
  for (const row of batch) {
    if (Date.now() - started > budgetMs && processed > 0) break;
    lastId = row.id;
    processed += 1;
    if (row.pinned) continue;
    if (row.lat === null && !row.city) continue;
    if (row.lat === null && row.enrichedAt === null && row.propertyId === null && registry[row.source]?.enrich) continue;
    const result = await assignProperty(db, row.id, { suppressNotifications: true, now });
    if (result.propertyId !== row.propertyId) moved += 1;
  }
  const finished = !hasMore && processed === batch.length;
  let removedProperties = 0;
  if (finished) removedProperties = await removeEmptyProperties(db);
  return { processed, moved, nextAfterId: finished ? null : lastId, removedProperties };
}

/** Properties left without listings after re-matching are dropped (hidden/favorite flags live on the listings' new property). */
export async function removeEmptyProperties(db: Db): Promise<number> {
  const result = await db.execute(sql`delete from properties p where not exists (select 1 from listings l where l.property_id = p.id)`);
  const count = (result as unknown as { rowCount?: number; affectedRows?: number; count?: number });
  return count.rowCount ?? count.affectedRows ?? count.count ?? 0;
}

/** Convenience for the CLI: runs batches until done, several passes until nothing moves. */
export async function reassignAll(db: Db, opts: { passes?: number; now?: Date; onPass?: (pass: number, processed: number, moved: number) => void } = {}): Promise<void> {
  const passes = opts.passes ?? 2;
  for (let pass = 1; pass <= passes; pass++) {
    let afterId = 0;
    let processed = 0;
    let moved = 0;
    for (;;) {
      const r = await reassignBatch(db, { afterId, limit: 200, now: opts.now });
      processed += r.processed;
      moved += r.moved;
      if (r.nextAfterId === null) break;
      afterId = r.nextAfterId;
    }
    opts.onPass?.(pass, processed, moved);
    if (moved === 0) break;
  }
}

