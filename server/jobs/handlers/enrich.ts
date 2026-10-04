import { areaContains } from "../../../shared/area";
import { assignProperty } from "../../dedup/match";
import { recomputeProperty } from "../../dedup/recompute";
import { MAX_ENRICH_ATTEMPTS, applyEnrichment, deleteListing, listingsNeedingEnrichment } from "../../db/queries/listings";
import { BudgetExceededError, RateLimitedError, SourceBlockedError } from "../../http/errors";
import { classifyError } from "../classify";
import { emptyStats, type HandlerDeps, type HandlerResult } from "../types";

const BATCH = 25;

/** Fetches ad pages for listings that still lack coordinates, then runs dedup for them. */
export async function handleEnrichJob(deps: HandlerDeps): Promise<HandlerResult> {
  const { db, adapter, ctx, now, remainingMs } = deps;
  const stats = emptyStats();
  if (!adapter.enrich) return { status: "done", stats };
  const costMs = adapter.estimatedEnrichCostMs ?? 1500;
  const cursor = deps.job.cursor ?? { kind: "plot", mode: deps.run.mode, page: 0 };

  for (;;) {
    const batch = await listingsNeedingEnrichment(db, adapter.id, BATCH);
    if (batch.length === 0) break;
    for (const listing of batch) {
      if (remainingMs() < costMs) return { status: "paused", cursor, notBefore: now(), stats };
      const t = now();
      try {
        const result = await adapter.enrich(listing, ctx);
        const lat = result.patch?.lat ?? null;
        const lon = result.patch?.lon ?? null;
        if (lat !== null && lon !== null && !areaContains(ctx.settings.area, lat, lon, Math.max(1, result.patch?.locationRadiusKm ?? 0))) {
          // The ad page placed it outside the search area: not an offer for this user.
          await deleteListing(db, listing.id, t);
          stats.outsideArea = (stats.outsideArea ?? 0) + 1;
          stats.enriched = (stats.enriched ?? 0) + 1;
          continue;
        }
        const updated = await applyEnrichment(db, listing.id, result.patch ?? {}, t, result.status !== "skip");
        stats.enriched = (stats.enriched ?? 0) + 1;
        if (result.status === "gone") {
          if (listing.propertyId !== null) await recomputeProperty(db, listing.propertyId, t);
          continue;
        }
        if (result.status === "ok" || (updated && updated.enrichAttempts >= MAX_ENRICH_ATTEMPTS)) {
          const a = await assignProperty(db, listing.id, { suppressNotifications: deps.suppressNotifications, now: t });
          if (a.created) stats.newProperties = (stats.newProperties ?? 0) + 1;
        }
      } catch (err) {
        if (err instanceof SourceBlockedError || err instanceof RateLimitedError || err instanceof BudgetExceededError) {
          return classifyError(err, cursor, stats, now());
        }
        const updated = await applyEnrichment(db, listing.id, {}, t, false);
        stats.errors!.push(`${adapter.id} enrich ${listing.sourceId}: ${err instanceof Error ? err.message : String(err)}`);
        if (updated && updated.enrichAttempts >= MAX_ENRICH_ATTEMPTS && updated.propertyId === null) {
          // Give up on coordinates: still show the listing, placed by city only.
          const a = await assignProperty(db, listing.id, { suppressNotifications: deps.suppressNotifications, now: t });
          if (a.created) stats.newProperties = (stats.newProperties ?? 0) + 1;
        }
      }
    }
  }
  return { status: "done", stats };
}
