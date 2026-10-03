import type { Kind } from "../../../shared/constants";
import { MAX_INCREMENTAL_PAGES, OTODOM_ESTATE, OTODOM_PAGE_SIZE } from "../../../shared/constants";
import type { ScrapeMode, Settings } from "../../../shared/schemas";
import type { ListingRow } from "../../db/schema";
import { HttpError } from "../../http/errors";
import type { Cursor, EnrichResult, ListPage, SourceAdapter, SourceContext } from "../types";
import { parseOtodomAd } from "./parse-ad";
import { extractNextData, parseOtodomSearch } from "./parse-list";
import {
  OTODOM_HTML_HEADERS,
  OTODOM_JSON_HEADERS,
  buildOtodomAdHtmlUrl,
  buildOtodomAdJsonUrl,
  buildOtodomListHtmlUrl,
  buildOtodomListJsonUrl,
  slugFromOtodomUrl,
} from "./search-url";

export interface OtodomCursor extends Cursor {
  totalPages?: number | null;
}

function isJsonResponse(contentType: string | null, text: string): boolean {
  return (contentType ?? "").includes("json") || text.trimStart().startsWith("{");
}

async function fetchJsonOrNull(ctx: SourceContext, url: string): Promise<{ status: number; json: unknown } | null> {
  const res = await ctx.http.get(url, OTODOM_JSON_HEADERS);
  if (res.status === 404) return { status: 404, json: null };
  if (res.status !== 200 || !isJsonResponse(res.headers.get("content-type"), res.text)) return null;
  try {
    return { status: 200, json: JSON.parse(res.text) };
  } catch {
    return null;
  }
}

async function fetchHtmlData(ctx: SourceContext, url: string): Promise<{ status: number; data: unknown }> {
  const res = await ctx.http.get(url, OTODOM_HTML_HEADERS);
  if (res.status === 404) return { status: 404, data: null };
  if (res.status !== 200) throw new HttpError(res.status, url);
  const data = extractNextData(res.text);
  if (!data) throw new HttpError(res.status, url, "Otodom page has no __NEXT_DATA__");
  return { status: 200, data };
}

export const otodomAdapter: SourceAdapter = {
  id: "otodom",
  label: "Otodom",
  rate: { minIntervalMs: 500, maxPer10Min: 800, maxPerSlice: 25 },
  estimatedPageCostMs: 2500,
  estimatedEnrichCostMs: 1200,

  initialCursor(kind: Kind, mode: ScrapeMode): OtodomCursor {
    return { kind, mode, page: 1 };
  },

  async fetchListPage(cursor: Cursor, ctx: SourceContext): Promise<ListPage> {
    const c = cursor as OtodomCursor;
    const settings: Settings = ctx.settings;
    const params = {
      estate: OTODOM_ESTATE[c.kind],
      locationPath: settings.otodom.locationPath,
      radiusKm: settings.otodom.radiusKm,
      page: c.page,
      limit: OTODOM_PAGE_SIZE,
    };
    const buildId = typeof ctx.meta.buildId === "string" ? ctx.meta.buildId : null;
    let data: unknown = null;
    if (buildId) {
      const json = await fetchJsonOrNull(ctx, buildOtodomListJsonUrl(buildId, params));
      if (json && json.status === 200) data = json.json;
      else ctx.log.info("otodom json route unavailable, falling back to html", { buildId });
    }
    if (!data) {
      const html = await fetchHtmlData(ctx, buildOtodomListHtmlUrl(params));
      if (html.status === 404) throw new HttpError(404, buildOtodomListHtmlUrl(params), "Otodom location path not found");
      data = html.data;
    }
    const parsed = parseOtodomSearch(data, c.kind);
    if (parsed.buildId && parsed.buildId !== buildId) await ctx.setMeta({ buildId: parsed.buildId });
    const totalPages = parsed.totalPages;
    const hasMore = parsed.items.length > 0 && totalPages !== null && c.page < totalPages;
    return { items: parsed.items, total: parsed.total, totalPages, hasMore, parseErrors: parsed.parseErrors };
  },

  nextCursor(cursor: Cursor, page: ListPage, info: { newCount: number }): Cursor | null {
    const c = cursor as OtodomCursor;
    if (!page.hasMore) return null;
    if (c.mode === "incremental" && (info.newCount === 0 || c.page >= MAX_INCREMENTAL_PAGES)) return null;
    return { ...c, page: c.page + 1, totalPages: page.totalPages };
  },

  async enrich(listing: ListingRow, ctx: SourceContext): Promise<EnrichResult> {
    const slug = slugFromOtodomUrl(listing.url);
    if (!slug) return { status: "skip" };
    const buildId = typeof ctx.meta.buildId === "string" ? ctx.meta.buildId : null;
    let data: unknown = null;
    let gone = false;
    if (buildId) {
      const json = await fetchJsonOrNull(ctx, buildOtodomAdJsonUrl(buildId, slug));
      if (json?.status === 200) data = json.json;
    }
    if (!data) {
      const html = await fetchHtmlData(ctx, buildOtodomAdHtmlUrl(slug));
      if (html.status === 404) gone = true;
      else data = html.data;
    }
    if (gone) return { status: "gone", patch: { isActive: false } };
    const ad = parseOtodomAd(data);
    if (!ad) return { status: "gone", patch: { isActive: false } };
    const patch: EnrichResult["patch"] = {
      lat: ad.lat,
      lon: ad.lon,
      locationPrecision: ad.locationPrecision,
      locationRadiusKm: ad.locationRadiusKm,
      attributes: { ...listing.attributes, ...ad.attributes },
      isActive: ad.status === null || ad.status === "active",
    };
    if (listing.areaM2 === null && ad.areaM2 !== null) patch.areaM2 = ad.areaM2;
    if (listing.kind === "house" && listing.plotAreaM2 === null && ad.plotAreaM2 !== null) patch.plotAreaM2 = ad.plotAreaM2;
    if (listing.kind === "plot" && ad.plotType) patch.plotType = ad.plotType;
    if (!listing.city && ad.city) patch.city = ad.city;
    return { status: "ok", patch };
  },
};
