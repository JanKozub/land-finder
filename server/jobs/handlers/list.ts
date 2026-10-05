import { areaContains } from "../../../shared/area";
import type { SourceTotals } from "../../../shared/schemas";
import { assignProperty } from "../../dedup/match";
import { addPriceHistory, deactivateUnseen, upsertListings } from "../../db/queries/listings";
import { recomputeProperties } from "../../db/queries/properties";
import type { Cursor, ListPage } from "../../sources/types";
import { classifyError } from "../classify";
import { emptyStats, type HandlerDeps, type HandlerResult } from "../types";

/** Walks list pages for one source/kind, upserting listings and assigning properties. Resumable via cursor. */
export async function handleListJob(deps: HandlerDeps): Promise<HandlerResult> {
  const { db, adapter, job, run, ctx, now, remainingMs } = deps;
  const kind = job.kind;
  if (!kind) return { status: "failed", stats: emptyStats(), error: "list job without kind" };
  const mode = job.type === "sweep" ? "sweep" : run.mode === "sweep" ? "sweep" : run.mode;
  let cursor: Cursor = (job.cursor as Cursor | null) ?? adapter.initialCursor(kind, mode, ctx.settings);
  const stats = emptyStats();
  const label = `${adapter.id}/${kind}`;

  for (;;) {
    if (remainingMs() < adapter.estimatedPageCostMs) return { status: "paused", cursor, notBefore: now(), stats };
    let page: ListPage;
    try {
      page = await adapter.fetchListPage(cursor, ctx);
    } catch (err) {
      return classifyError(err, cursor, stats, now());
    }
    stats.pages = (stats.pages ?? 0) + 1;
    if (page.parseErrors > 0) stats.errors!.push(`${label} p${cursor.page}: ${page.parseErrors} unparsable items`);

    // Portal searches are circles or whole gminas; only what lies in the configured rectangle is kept.
    const area = ctx.settings.area;
    const inside = page.items.filter((i) => i.lat === null || i.lon === null || areaContains(area, i.lat, i.lon, Math.max(1, i.locationRadiusKm ?? 0)));
    stats.outsideArea = (stats.outsideArea ?? 0) + (page.items.length - inside.length);
    if (page.total !== null && isFirstPage(cursor)) await recordTotal(ctx, kind, cursor, page.total, now());

    const t = now();
    const results = await upsertListings(db, inside, t);
    const newCount = results.filter((r) => r.inserted).length;
    stats.newListings = (stats.newListings ?? 0) + newCount;
    stats.updatedListings = (stats.updatedListings ?? 0) + results.filter((r) => !r.inserted && r.changed).length;
    await addPriceHistory(
      db,
      results
        .filter((r) => r.priceChanged && r.price !== null)
        .map((r) => ({ listingId: r.id, price: r.price!, observedAt: t })),
    );
    for (const r of results) {
      if (!r.needsAssignment) continue;
      if (!r.hasCoords && r.propertyId === null && adapter.enrich) continue; // waits for enrichment
      const a = await assignProperty(db, r.id, { suppressNotifications: deps.suppressNotifications, now: t });
      if (a.created) stats.newProperties = (stats.newProperties ?? 0) + 1;
    }
    ctx.log.info("list page processed", { source: adapter.id, kind, page: cursor.page, items: page.items.length, newCount });

    const next = adapter.nextCursor(cursor, page, { newCount });
    if (!next) break;
    cursor = next;
  }

  if (mode === "sweep") {
    const t = now();
    const gone = await deactivateUnseen(db, adapter.id, kind, run.startedAt, t);
    await recomputeProperties(db, gone.map((g) => g.propertyId), t);
    stats.deactivated = (stats.deactivated ?? 0) + gone.length;
  }
  return { status: "done", stats };
}

/** The first page of an unsplit query: OLX backfills walk price buckets, whose totals are partial. */
export function isFirstPage(cursor: Cursor): boolean {
  if ("buckets" in cursor && cursor.buckets) return false;
  return cursor.page === 1 || cursor.page === 0; // OLX pages are 0-based
}

/** Remembers what the portal says it has for this query, so the UI can show coverage. */
async function recordTotal(ctx: HandlerDeps["ctx"], kind: string, cursor: Cursor, total: number, at: Date): Promise<void> {
  const locations = Array.isArray(cursor.locations) ? (cursor.locations as string[]) : null;
  const locKey = locations ? (locations[typeof cursor.locIdx === "number" ? cursor.locIdx : 0] ?? "0") : "0";
  const totals: SourceTotals = { ...((ctx.meta.totals as SourceTotals | undefined) ?? {}) };
  const current = { ...(totals[kind] ?? {}) };
  // Locations no longer configured drop out so the sum does not keep stale numbers.
  for (const key of Object.keys(current)) if (locations && !locations.includes(key)) delete current[key];
  current[locKey] = { total, at: at.toISOString() };
  totals[kind] = current;
  await ctx.setMeta({ totals });
}
