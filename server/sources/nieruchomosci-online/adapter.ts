import type { Kind } from "../../../shared/constants";
import type { ScrapeMode, Settings } from "../../../shared/schemas";
import { HttpError } from "../../http/errors";
import { splitLocations } from "../html";
import { incrementalStep } from "../paging";
import type { Cursor, ListPage, SourceAdapter, SourceContext } from "../types";
import { parseNoList } from "./parse-list";
import { NO_HEADERS, buildNoListUrl } from "./search-url";

export interface NoCursor extends Cursor {
  locations: string[];
  locIdx: number;
}

/** Coordinates come with the list page, so there is no enrichment step (the ad page adds none). */
export const nieruchomosciOnlineAdapter: SourceAdapter = {
  id: "nieruchomosci_online",
  label: "Nieruchomosci-online",
  rate: { minIntervalMs: 2000, maxPer10Min: 150, maxPerSlice: 10 },
  estimatedPageCostMs: 3500,

  probe(settings: Settings) {
    const cfg = settings.nieruchomosci_online;
    return { url: buildNoListUrl({ kind: "plot", location: splitLocations(cfg.location)[0]!, radiusKm: cfg.radiusKm, page: 1 }), headers: NO_HEADERS };
  },

  initialCursor(kind: Kind, mode: ScrapeMode, settings: Settings): NoCursor {
    return { kind, mode, page: 1, locations: splitLocations(settings.nieruchomosci_online.location), locIdx: 0 };
  },

  async fetchListPage(cursor: Cursor, ctx: SourceContext): Promise<ListPage> {
    const c = cursor as NoCursor;
    const url = buildNoListUrl({ kind: c.kind, location: c.locations[c.locIdx]!, radiusKm: ctx.settings.nieruchomosci_online.radiusKm, page: c.page });
    const res = await ctx.http.get(url, NO_HEADERS);
    if (res.status !== 200) throw new HttpError(res.status, url);
    const page = parseNoList(res.text, c.kind);
    const hasMore = page.items.length > 0 && page.totalPages !== null && c.page < page.totalPages;
    return { items: page.items, total: page.total, totalPages: page.totalPages, hasMore, parseErrors: page.parseErrors };
  },

  nextCursor(cursor: Cursor, page: ListPage, info: { newCount: number }): Cursor | null {
    const c = cursor as NoCursor;
    const step = incrementalStep(c, page, info, c.page);
    if (!step.stop) return { ...c, page: c.page + 1, emptyStreak: step.emptyStreak };
    if (c.locIdx + 1 < c.locations.length) return { ...c, page: 1, locIdx: c.locIdx + 1, emptyStreak: 0 };
    return null;
  },
};
