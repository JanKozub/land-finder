import type { Kind } from "../../../shared/constants";
import type { ScrapeMode, Settings } from "../../../shared/schemas";
import type { ListingRow } from "../../db/schema";
import { HttpError } from "../../http/errors";
import { splitLocations } from "../html";
import { incrementalStep } from "../paging";
import type { Cursor, EnrichResult, ListPage, SourceAdapter, SourceContext } from "../types";
import { parseAdresowoAd } from "./parse-ad";
import { parseAdresowoList } from "./parse-list";
import { ADRESOWO_HEADERS, ADRESOWO_ORIGIN, buildAdresowoListUrl } from "./search-url";

export interface AdresowoCursor extends Cursor {
  locations: string[];
  locIdx: number;
  /** rel="next" of the page just fetched; page numbering on the portal is irregular, so links are followed. */
  nextUrl?: string | null;
}

export const adresowoAdapter: SourceAdapter = {
  id: "adresowo",
  label: "Adresowo",
  rate: { minIntervalMs: 2000, maxPer10Min: 200, maxPerSlice: 15 },
  estimatedPageCostMs: 2500,
  estimatedEnrichCostMs: 2500,
  enrichConcurrency: 2,

  probe(settings: Settings) {
    const location = splitLocations(settings.adresowo.location)[0]!;
    return { url: buildAdresowoListUrl({ kind: "plot", location, radiusKm: settings.adresowo.radiusKm }), headers: ADRESOWO_HEADERS };
  },

  initialCursor(kind: Kind, mode: ScrapeMode, settings: Settings): AdresowoCursor {
    return { kind, mode, page: 1, locations: splitLocations(settings.adresowo.location), locIdx: 0, nextUrl: null };
  },

  async fetchListPage(cursor: Cursor, ctx: SourceContext): Promise<ListPage> {
    const c = cursor as AdresowoCursor;
    const location = c.locations[c.locIdx]!;
    const url = c.nextUrl ?? buildAdresowoListUrl({ kind: c.kind, location, radiusKm: ctx.settings.adresowo.radiusKm });
    const res = await ctx.http.get(url, ADRESOWO_HEADERS);
    if (res.status !== 200) throw new HttpError(res.status, url);
    const page = parseAdresowoList(res.text, c.kind);
    if (!page.resolvedLocation && page.items.length === 0) {
      throw new HttpError(res.status, url, `Adresowo does not recognise the location "${location}" (use a slug from the portal's URLs, e.g. powiat-wielicki or wieliczka-1)`);
    }
    return { items: page.items, total: page.total, totalPages: null, hasMore: page.nextUrl !== null, parseErrors: page.parseErrors, next: { nextUrl: page.nextUrl } };
  },

  nextCursor(cursor: Cursor, page: ListPage, info: { newCount: number }): Cursor | null {
    const c = cursor as AdresowoCursor;
    const step = incrementalStep(c, page, info, c.page);
    if (!step.stop) return { ...c, page: c.page + 1, nextUrl: (page.next?.nextUrl as string | null | undefined) ?? null, emptyStreak: step.emptyStreak };
    if (c.locIdx + 1 < c.locations.length) return { ...c, page: 1, locIdx: c.locIdx + 1, nextUrl: null, emptyStreak: 0 };
    return null;
  },

  async enrich(listing: ListingRow, ctx: SourceContext): Promise<EnrichResult> {
    if (!listing.url.startsWith(ADRESOWO_ORIGIN)) return { status: "skip" };
    const res = await ctx.http.get(listing.url, ADRESOWO_HEADERS);
    if (res.status === 404 || res.status === 410) return { status: "gone", patch: { isActive: false } };
    if (res.status !== 200) throw new HttpError(res.status, listing.url);
    const ad = parseAdresowoAd(res.text);
    if (!ad) return { status: "gone", patch: { isActive: false } };
    const exact = ad.radiusM !== null && ad.radiusM <= 0;
    const patch: EnrichResult["patch"] = {
      lat: ad.lat,
      lon: ad.lon,
      locationPrecision: ad.lat === null ? "unknown" : exact ? "exact" : "approx",
      locationRadiusKm: ad.lat === null ? null : exact ? 0 : ad.radiusM !== null ? ad.radiusM / 1000 : 1,
      priceNegotiable: ad.priceNegotiable,
      attributes: { ...listing.attributes, gmina: ad.gmina, powiat: ad.powiat, params: ad.params },
    };
    if (ad.city) patch.city = ad.city;
    if (ad.region) patch.region = ad.region;
    if (ad.isPrivate !== null) patch.isPrivate = ad.isPrivate;
    if (listing.kind === "house" && ad.plotAreaM2 !== null) patch.plotAreaM2 = ad.plotAreaM2;
    if (listing.sourceCreatedAt === null && ad.addedDaysAgo !== null) {
      const d = new Date(ctx.now().getTime() - ad.addedDaysAgo * 86_400_000);
      patch.sourceCreatedAt = d;
      patch.sourceRefreshedAt = d;
    }
    if (listing.kind === "plot") {
      const plotType = ad.params["Rodzaj działki"] ?? ad.params["Typ działki"];
      if (plotType) patch.plotType = plotType.toLowerCase();
    }
    return { status: "ok", patch };
  },
};
