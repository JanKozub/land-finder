import type { Kind } from "../../../shared/constants";
import { OTODOM_ESTATE, OTODOM_PAGE_SIZE, snapOtodomRadius } from "../../../shared/constants";
import type { ScrapeMode, Settings } from "../../../shared/schemas";
import type { ListingRow } from "../../db/schema";
import { HttpError, RetryLaterError } from "../../http/errors";
import { incrementalStep } from "../paging";
import type { Cursor, EnrichResult, ListPage, SourceAdapter, SourceContext } from "../types";
import { parseOtodomAd } from "./parse-ad";
import { extractNextData, parseOtodomSearch, redirectOf, searchAdsOf } from "./parse-list";
import { probeOtodomTotal } from "./probe";
import {
  OTODOM_HTML_HEADERS,
  OTODOM_JSON_HEADERS,
  OTODOM_ORIGIN,
  buildOtodomAdHtmlUrl,
  buildOtodomAdJsonUrl,
  buildOtodomListHtmlUrl,
  buildOtodomListJsonUrl,
  slugFromOtodomUrl,
  type OtodomSearchParams,
} from "./search-url";

export interface OtodomCursor extends Cursor {
  /** Figures announced by page 1; later answers that fall far below them come from a different result set. */
  totalPages?: number | null;
  total?: number | null;
  /** Pauses taken on the current page because of a different result set. */
  retries?: number;
}

/**
 * Otodom now and then answers with the radius-less result set (the gmina alone), whatever the radius: sometimes a
 * single request (2026-10-04: 25 km page 24 → redirect stub, neighbours fine), sometimes for a minute or more (page 4
 * failed on both routes four times in 7 s, then worked 3 minutes later). The page is asked once more on the other
 * route, then the job pauses for a while and comes back to the same page; after too many pauses it fails.
 */
const OTODOM_PAGE_TRIES = 2;
const OTODOM_PAGE_RETRY_MS = 30_000;
const OTODOM_MAX_PAGE_RETRIES = 8;

function isJsonResponse(contentType: string | null, text: string): boolean {
  return (contentType ?? "").includes("json") || text.trimStart().startsWith("{");
}

async function fetchJsonOrNull(ctx: SourceContext, url: string): Promise<{ status: number; json: unknown } | null> {
  const res = await ctx.http.get(url, OTODOM_JSON_HEADERS);
  if (res.status === 404 || res.status === 410) return { status: 404, json: null }; // 410: the ad was withdrawn
  if (res.status !== 200 || !isJsonResponse(res.headers.get("content-type"), res.text)) return null;
  try {
    return { status: 200, json: JSON.parse(res.text) };
  } catch {
    return null;
  }
}

async function fetchHtmlData(ctx: SourceContext, url: string): Promise<{ status: number; data: unknown }> {
  const res = await ctx.http.get(url, OTODOM_HTML_HEADERS);
  if (res.status === 404 || res.status === 410) return { status: 404, data: null };
  if (res.status !== 200) throw new HttpError(res.status, url);
  const data = extractNextData(res.text);
  if (!data) throw new HttpError(res.status, url, "Otodom page has no __NEXT_DATA__");
  return { status: 200, data };
}

/** `page` of a search URL (relative or absolute); a URL without the parameter means page 1. */
function pageOfUrl(url: string): number | null {
  try {
    const raw = new URL(url, OTODOM_ORIGIN).searchParams.get("page");
    if (raw === null) return 1;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Landing far below what page 1 announced means the portal answered a different query, not that the list ended. */
function farBelow(expected: number | null, actual: number): boolean {
  return expected !== null && actual < expected / 2;
}

type PageOutcome = { kind: "page" | "end"; page: ListPage } | { kind: "wrong"; detail: string };

/**
 * Otodom answers a page number past the last one by redirecting to the last page (the `_next/data` route hands back a
 * `__N_REDIRECT` stub instead). Landing a little short of what page 1 announced only means the result set shrank
 * during the walk.
 */
function endOfList(c: OtodomCursor, landedPage: number, ctx: SourceContext): PageOutcome {
  ctx.log.info("otodom list ended before the expected page", { page: c.page, landedPage, expected: c.totalPages ?? null });
  return { kind: "end", page: { items: [], total: null, totalPages: landedPage, hasMore: false, parseErrors: 0 } };
}

async function fetchListPageOnce(c: OtodomCursor, ctx: SourceContext, params: OtodomSearchParams, preferJson: boolean): Promise<PageOutcome> {
  const expectedPages = typeof c.totalPages === "number" ? c.totalPages : null;
  const expectedTotal = typeof c.total === "number" ? c.total : null;
  const buildId = typeof ctx.meta.buildId === "string" ? ctx.meta.buildId : null;
  let data: unknown = null;
  if (buildId && preferJson) {
    const json = await fetchJsonOrNull(ctx, buildOtodomListJsonUrl(buildId, params));
    const redirect = json?.status === 200 ? redirectOf(json.json) : null;
    if (redirect !== null) {
      const landed = pageOfUrl(redirect);
      if (landed !== null && landed < c.page) {
        if (farBelow(expectedPages, landed)) return { kind: "wrong", detail: `redirected page ${c.page} to page ${landed} although page 1 announced ${expectedPages} pages` };
        return endOfList(c, landed, ctx);
      }
      ctx.log.info("otodom json route redirected, falling back to html", { page: c.page, redirect });
    } else if (json?.status === 200 && searchAdsOf(json.json)) {
      data = json.json;
    } else {
      ctx.log.info("otodom json route unavailable, falling back to html", { buildId, status: json?.status ?? null });
    }
  }
  if (!data) {
    const htmlUrl = buildOtodomListHtmlUrl(params);
    const html = await fetchHtmlData(ctx, htmlUrl);
    if (html.status === 404) throw new HttpError(404, htmlUrl, "Otodom location path not found");
    data = html.data;
  }
  const parsed = parseOtodomSearch(data, c.kind);
  if (parsed.buildId && parsed.buildId !== buildId) await ctx.setMeta({ buildId: parsed.buildId });
  // The HTML route follows the past-the-end redirect, so the landing page shows up as a different currentPage.
  if (parsed.currentPage !== null && parsed.currentPage < c.page) {
    if (farBelow(expectedPages, parsed.currentPage)) return { kind: "wrong", detail: `landed on page ${parsed.currentPage} of ${parsed.totalPages ?? "?"} instead of page ${c.page} of ${expectedPages}` };
    return endOfList(c, parsed.currentPage, ctx);
  }
  if (parsed.total !== null && farBelow(expectedTotal, parsed.total)) {
    return { kind: "wrong", detail: `${parsed.total} results instead of the ${expectedTotal} announced on page 1` };
  }
  // Page 1 has nothing to compare with, so one extra request fetches the radius-less count; equal counts mean the
  // radius was dropped (a locality path, as opposed to a gmina path, always drops it for plots).
  if (c.page === 1 && params.radiusKm > 0 && parsed.total !== null) {
    const withoutRadius = await probeOtodomTotal(ctx.http, { estate: params.estate, locationPath: params.locationPath, radiusKm: 0 });
    if (withoutRadius !== null && withoutRadius === parsed.total) {
      return { kind: "wrong", detail: `the ${withoutRadius} results of the location alone instead of the ${params.radiusKm} km radius` };
    }
  }
  const totalPages = parsed.totalPages;
  const hasMore = parsed.items.length > 0 && totalPages !== null && c.page < totalPages;
  return { kind: "page", page: { items: parsed.items, total: parsed.total, totalPages, hasMore, parseErrors: parsed.parseErrors } };
}

export const otodomAdapter: SourceAdapter = {
  id: "otodom",
  label: "Otodom",
  rate: { minIntervalMs: 500, maxPer10Min: 800, maxPerSlice: 25 },
  estimatedPageCostMs: 2500,
  estimatedEnrichCostMs: 1200,
  enrichConcurrency: 4,

  probe(settings: Settings) {
    const url = buildOtodomListHtmlUrl({ estate: OTODOM_ESTATE.plot, locationPath: settings.otodom.locationPath, radiusKm: snapOtodomRadius(settings.otodom.radiusKm), page: 1, limit: 24 });
    return { url, headers: OTODOM_HTML_HEADERS };
  },

  initialCursor(kind: Kind, mode: ScrapeMode): OtodomCursor {
    return { kind, mode, page: 1 };
  },

  async fetchListPage(cursor: Cursor, ctx: SourceContext): Promise<ListPage> {
    const c = cursor as OtodomCursor;
    const settings: Settings = ctx.settings;
    const params: OtodomSearchParams = {
      estate: OTODOM_ESTATE[c.kind],
      locationPath: settings.otodom.locationPath,
      radiusKm: snapOtodomRadius(settings.otodom.radiusKm),
      page: c.page,
      limit: OTODOM_PAGE_SIZE,
    };
    for (let attempt = 1; ; attempt++) {
      const outcome = await fetchListPageOnce(c, ctx, params, attempt % 2 === 1);
      if (outcome.kind !== "wrong") return outcome.page;
      if (attempt >= OTODOM_PAGE_TRIES) {
        const retries = (typeof c.retries === "number" ? c.retries : 0) + 1;
        const detail = `Otodom answered page ${c.page} with a different result set (${outcome.detail})`;
        if (retries > OTODOM_MAX_PAGE_RETRIES) throw new Error(`${detail} ${retries} times in a row; giving up on this attempt`);
        throw new RetryLaterError("otodom", new Date(ctx.now().getTime() + OTODOM_PAGE_RETRY_MS), `${detail}; pausing ${OTODOM_PAGE_RETRY_MS / 1000} s (pause ${retries}/${OTODOM_MAX_PAGE_RETRIES})`, { retries });
      }
      ctx.log.warn("otodom answered with a different result set, asking again", { page: c.page, attempt, detail: outcome.detail });
    }
  },

  nextCursor(cursor: Cursor, page: ListPage, info: { newCount: number }): Cursor | null {
    const c = cursor as OtodomCursor;
    const step = incrementalStep(c, page, info, c.page);
    if (step.stop) return null;
    return { ...c, page: c.page + 1, totalPages: page.totalPages, total: page.total ?? c.total ?? null, emptyStreak: step.emptyStreak, retries: 0 };
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
