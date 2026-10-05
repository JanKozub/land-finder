import { areaContains } from "../../../shared/area";
import { assignProperty } from "../../dedup/match";
import { recomputeProperty } from "../../dedup/recompute";
import { MAX_ENRICH_ATTEMPTS, applyEnrichment, deleteListing, listingsNeedingEnrichment } from "../../db/queries/listings";
import type { ListingRow } from "../../db/schema";
import { BudgetExceededError, RateLimitedError, SourceBlockedError } from "../../http/errors";
import { classifyError } from "../classify";
import { emptyStats, type HandlerDeps, type HandlerResult } from "../types";

const BATCH = 25;
const LOG_EVERY = 10;

/**
 * Fetches ad pages for listings that still lack coordinates, then runs dedup for them. Pages are fetched a few at a
 * time (`enrichConcurrency`), but property assignment stays sequential: two listings of one property assigned at
 * the same moment would each miss the other and end up as two properties.
 */
export async function handleEnrichJob(deps: HandlerDeps): Promise<HandlerResult> {
  const { db, adapter, ctx, now, remainingMs } = deps;
  const stats = emptyStats();
  if (!adapter.enrich) return { status: "done", stats };
  const enrich = adapter.enrich.bind(adapter);
  const costMs = adapter.estimatedEnrichCostMs ?? 1500;
  const cursor = deps.job.cursor ?? { kind: "plot", mode: deps.run.mode, page: 0 };
  const concurrency = Math.max(1, Math.floor(deps.enrichConcurrency ?? 1));
  let processed = 0;
  const progress = () =>
    ctx.log.info("enrich progress", { source: adapter.id, processed, enriched: stats.enriched ?? 0, outsideArea: stats.outsideArea ?? 0, errors: stats.errors?.length ?? 0 });

  let chain: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  /** First reason to stop (budget, rate window, block); lanes finish their current listing and exit. */
  let stop: HandlerResult | null = null;

  const processOne = async (listing: ListingRow): Promise<void> => {
    const t = now();
    try {
      const result = await enrich(listing, ctx);
      const lat = result.patch?.lat ?? null;
      const lon = result.patch?.lon ?? null;
      if (lat !== null && lon !== null && !areaContains(ctx.settings.area, lat, lon, Math.max(1, result.patch?.locationRadiusKm ?? 0))) {
        // The ad page placed it outside the search area: not an offer for this user.
        await deleteListing(db, listing.id, t);
        stats.outsideArea = (stats.outsideArea ?? 0) + 1;
        stats.enriched = (stats.enriched ?? 0) + 1;
        return;
      }
      const updated = await applyEnrichment(db, listing.id, result.patch ?? {}, t, result.status !== "skip");
      stats.enriched = (stats.enriched ?? 0) + 1;
      if (result.status === "gone") {
        const previous = listing.propertyId;
        if (previous !== null) await serialized(() => recomputeProperty(db, previous, t));
        return;
      }
      if (result.status === "ok" || (updated && updated.enrichAttempts >= MAX_ENRICH_ATTEMPTS)) {
        const a = await serialized(() => assignProperty(db, listing.id, { suppressNotifications: deps.suppressNotifications, now: t }));
        if (a.created) stats.newProperties = (stats.newProperties ?? 0) + 1;
      }
    } catch (err) {
      if (err instanceof SourceBlockedError || err instanceof RateLimitedError || err instanceof BudgetExceededError) {
        stop ??= classifyError(err, cursor, stats, now());
        return;
      }
      const updated = await applyEnrichment(db, listing.id, {}, t, false);
      stats.errors!.push(`${adapter.id} enrich ${listing.sourceId}: ${err instanceof Error ? err.message : String(err)}`);
      if (updated && updated.enrichAttempts >= MAX_ENRICH_ATTEMPTS && updated.propertyId === null) {
        // Give up on coordinates: still show the listing, placed by city only.
        const a = await serialized(() => assignProperty(db, listing.id, { suppressNotifications: deps.suppressNotifications, now: t }));
        if (a.created) stats.newProperties = (stats.newProperties ?? 0) + 1;
      }
    }
  };

  for (;;) {
    const batch = await listingsNeedingEnrichment(db, adapter.id, BATCH);
    if (batch.length === 0) break;
    let next = 0;
    const lane = async (): Promise<void> => {
      while (stop === null) {
        const listing = batch[next++];
        if (!listing) return;
        if (remainingMs() < costMs) {
          stop ??= { status: "paused", cursor, notBefore: now(), stats };
          return;
        }
        processed += 1;
        if (processed % LOG_EVERY === 0) progress();
        await processOne(listing);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, lane));
    if (stop) {
      if (processed % LOG_EVERY !== 0) progress();
      return stop;
    }
  }
  if (processed % LOG_EVERY !== 0) progress();
  return { status: "done", stats };
}
