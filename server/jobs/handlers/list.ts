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

    const t = now();
    const results = await upsertListings(db, page.items, t);
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
      if (!(r.inserted || r.changed)) continue;
      if (!r.hasCoords && r.propertyId === null) continue; // waits for enrichment
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
