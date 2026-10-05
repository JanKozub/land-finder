import type { Kind } from "../../../shared/constants";
import type { ScrapeMode, Settings } from "../../../shared/schemas";
import type { ListingRow } from "../../db/schema";
import { HttpError } from "../../http/errors";
import { incrementalStep } from "../paging";
import type { Cursor, EnrichResult, ListPage, SourceAdapter, SourceContext } from "../types";
import { parseDomiportaAd } from "./parse-ad";
import { parseDomiportaList } from "./parse-list";
import { DOMIPORTA_HEADERS, DOMIPORTA_ORIGIN, buildDomiportaListUrl } from "./search-url";

export const domiportaAdapter: SourceAdapter = {
  id: "domiporta",
  label: "Domiporta",
  rate: { minIntervalMs: 1500, maxPer10Min: 250, maxPerSlice: 20 },
  estimatedPageCostMs: 2500,
  estimatedEnrichCostMs: 1800,
  enrichConcurrency: 2,

  probe(settings: Settings) {
    return { url: buildDomiportaListUrl({ kind: "plot", location: settings.domiporta.location, radiusKm: settings.domiporta.radiusKm, page: 1 }), headers: DOMIPORTA_HEADERS };
  },

  initialCursor(kind: Kind, mode: ScrapeMode): Cursor {
    return { kind, mode, page: 1 };
  },

  async fetchListPage(cursor: Cursor, ctx: SourceContext): Promise<ListPage> {
    const cfg = ctx.settings.domiporta;
    const url = buildDomiportaListUrl({ kind: cursor.kind, location: cfg.location, radiusKm: cfg.radiusKm, page: cursor.page });
    const res = await ctx.http.get(url, DOMIPORTA_HEADERS);
    if (res.status !== 200) throw new HttpError(res.status, url);
    const page = parseDomiportaList(res.text, cursor.kind);
    if (page.items.length === 0 && page.total === null) throw new HttpError(res.status, url, "Domiporta page has no listings (location path unknown?)");
    const hasMore = page.items.length > 0 && page.hasNext && (page.totalPages === null || cursor.page < page.totalPages);
    return { items: page.items, total: page.total, totalPages: page.totalPages, hasMore, parseErrors: page.parseErrors };
  },

  nextCursor(cursor: Cursor, page: ListPage, info: { newCount: number }): Cursor | null {
    const step = incrementalStep(cursor, page, info, cursor.page);
    if (step.stop) return null;
    return { ...cursor, page: cursor.page + 1, emptyStreak: step.emptyStreak };
  },

  async enrich(listing: ListingRow, ctx: SourceContext): Promise<EnrichResult> {
    if (!listing.url.startsWith(DOMIPORTA_ORIGIN)) return { status: "skip" };
    const res = await ctx.http.get(listing.url, DOMIPORTA_HEADERS);
    if (res.status === 404 || res.status === 410) return { status: "gone", patch: { isActive: false } };
    if (res.status !== 200) throw new HttpError(res.status, listing.url);
    const ad = parseDomiportaAd(res.text);
    if (!ad) return { status: "gone", patch: { isActive: false } };
    const patch: EnrichResult["patch"] = {
      lat: ad.lat,
      lon: ad.lon,
      locationPrecision: ad.lat !== null ? "exact" : "unknown",
      locationRadiusKm: ad.lat !== null ? 0 : null,
      attributes: { ...listing.attributes, ...ad.attributes },
    };
    if (ad.isPrivate !== null) patch.isPrivate = ad.isPrivate;
    if (listing.kind === "plot" && ad.plotType) patch.plotType = ad.plotType;
    if (listing.areaM2 === null && ad.areaM2 !== null) patch.areaM2 = ad.areaM2;
    return { status: "ok", patch };
  },
};
