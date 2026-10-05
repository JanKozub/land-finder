import type { Kind, Source } from "../../../shared/constants";
import type { PortalSettings, ScrapeMode, Settings } from "../../../shared/schemas";
import type { ListingRow } from "../../db/schema";
import { HttpError } from "../../http/errors";
import { splitLocations } from "../html";
import { incrementalStep } from "../paging";
import { extractNuxtData } from "../nuxt";
import type { Cursor, EnrichResult, ListPage, SourceAdapter, SourceContext } from "../types";
import { parseMgAd, parseMgListing } from "./nuxt-listing";

export const MG_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "pl-PL,pl;q=0.9",
};

export interface MgCursor extends Cursor {
  locations: string[];
  locIdx: number;
  totalPages?: number | null;
}

export interface MgAdapterSpec {
  id: Source;
  label: string;
  origin: string;
  settingsOf(settings: Settings): PortalSettings;
  listUrl(p: { kind: Kind; location: string; page: number }): string;
}

/** Builds the Gratka or Morizon adapter: same payloads, different origins and URL grammars. */
export function createMgAdapter(spec: MgAdapterSpec): SourceAdapter {
  const fetchPayload = async (ctx: SourceContext, url: string): Promise<{ status: number; data: unknown }> => {
    const res = await ctx.http.get(url, MG_HEADERS);
    if (res.status === 404 || res.status === 410) return { status: 404, data: null };
    if (res.status !== 200) throw new HttpError(res.status, url);
    const data = extractNuxtData(res.text);
    // A page without the payload is a Cloudflare challenge or a layout change; stop rather than mis-parse.
    if (!data) throw new HttpError(res.status, url, `${spec.label} page has no __NUXT_DATA__`);
    return { status: 200, data };
  };

  return {
    id: spec.id,
    label: spec.label,
    rate: { minIntervalMs: 2000, maxPer10Min: 150, maxPerSlice: 12 },
    estimatedPageCostMs: 3000,
    estimatedEnrichCostMs: 3000,
    enrichConcurrency: 2,

    probe(settings: Settings) {
      const location = splitLocations(spec.settingsOf(settings).location)[0]!;
      return { url: spec.listUrl({ kind: "plot", location, page: 1 }), headers: MG_HEADERS };
    },

    initialCursor(kind: Kind, mode: ScrapeMode, settings: Settings): MgCursor {
      return { kind, mode, page: 1, locations: splitLocations(spec.settingsOf(settings).location), locIdx: 0 };
    },

    async fetchListPage(cursor: Cursor, ctx: SourceContext): Promise<ListPage> {
      const c = cursor as MgCursor;
      const location = c.locations[c.locIdx]!;
      const url = spec.listUrl({ kind: c.kind, location, page: c.page });
      const { status, data } = await fetchPayload(ctx, url);
      if (status === 404) throw new HttpError(404, url, `${spec.label} location "${location}" not found`);
      const page = parseMgListing(data, c.kind, spec.id, spec.origin);
      const totalPages = page.total === null ? null : Math.max(1, Math.ceil(page.total / page.pageSize));
      const hasMore = page.items.length > 0 && totalPages !== null && c.page < totalPages;
      return { items: page.items, total: page.total, totalPages, hasMore, parseErrors: page.parseErrors };
    },

    nextCursor(cursor: Cursor, page: ListPage, info: { newCount: number }): Cursor | null {
      const c = cursor as MgCursor;
      const step = incrementalStep(c, page, info, c.page);
      if (!step.stop) return { ...c, page: c.page + 1, totalPages: page.totalPages, emptyStreak: step.emptyStreak };
      if (c.locIdx + 1 < c.locations.length) return { ...c, page: 1, locIdx: c.locIdx + 1, totalPages: null, emptyStreak: 0 };
      return null;
    },

    async enrich(listing: ListingRow, ctx: SourceContext): Promise<EnrichResult> {
      if (!listing.url.startsWith(spec.origin)) return { status: "skip" };
      const { status, data } = await fetchPayload(ctx, listing.url);
      if (status === 404) return { status: "gone", patch: { isActive: false } };
      const ad = parseMgAd(data);
      if (!ad || !ad.active) return { status: "gone", patch: { isActive: false } };
      const located = ad.lat !== null && ad.lon !== null;
      const patch: EnrichResult["patch"] = {
        lat: ad.lat,
        lon: ad.lon,
        locationPrecision: located ? "approx" : "unknown",
        locationRadiusKm: located ? (ad.hasStreet ? 0.5 : 1.5) : null,
        attributes: { ...listing.attributes, details: ad.details },
      };
      if (listing.kind === "house" && ad.plotAreaM2 !== null) patch.plotAreaM2 = ad.plotAreaM2;
      if (listing.kind === "plot" && ad.plotType) patch.plotType = ad.plotType;
      if (listing.sourceCreatedAt === null && ad.addedAt) patch.sourceCreatedAt = ad.addedAt;
      if (!listing.descriptionExcerpt && ad.descriptionExcerpt) patch.descriptionExcerpt = ad.descriptionExcerpt;
      return { status: "ok", patch };
    },
  };
}
