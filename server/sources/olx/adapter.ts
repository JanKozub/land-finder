import type { Kind } from "../../../shared/constants";
import { MAX_INCREMENTAL_PAGES, OLX_CATEGORY, OLX_OFFSET_CAP, OLX_PAGE_SIZE, OLX_PRICE_BUCKETS } from "../../../shared/constants";
import type { ScrapeMode, Settings } from "../../../shared/schemas";
import { HttpError } from "../../http/errors";
import type { Cursor, ListPage, SourceAdapter, SourceContext } from "../types";
import { OLX_JSON_HEADERS, buildOlxOffersUrl } from "./client";
import { parseOlxOffersResponse } from "./parse";

export type PriceBucket = [number, number | null];

export interface OlxCursor extends Cursor {
  buckets?: PriceBucket[];
  bucketIdx?: number;
  priceFrom?: number | null;
  priceTo?: number | null;
}

/** Above this many results a bucket is split in half so that the ~1000 offset cap is never hit. */
export const OLX_SPLIT_THRESHOLD = 950;
const MIN_BUCKET_WIDTH = 10_000;

export function initialBuckets(kind: Kind): PriceBucket[] {
  const edges = OLX_PRICE_BUCKETS[kind];
  return edges.map((from, i) => [from, edges[i + 1] ?? null] as PriceBucket);
}

/** Splits the bucket at `idx` in two; returns null when it cannot be split further. */
export function splitBucket(buckets: PriceBucket[], idx: number): PriceBucket[] | null {
  const b = buckets[idx];
  if (!b) return null;
  const [from, to] = b;
  const mid = to === null ? Math.max(from * 2, from + 1_000_000) : Math.round((from + to) / 2);
  if (to !== null && to - from < MIN_BUCKET_WIDTH * 2) return null;
  const next: PriceBucket[] = [...buckets];
  next.splice(idx, 1, [from, mid], [mid, to]);
  return next;
}

export const olxAdapter: SourceAdapter = {
  id: "olx",
  label: "OLX",
  rate: { minIntervalMs: 2000, maxPer10Min: 20, maxPerSlice: 6 },
  estimatedPageCostMs: 2500,

  initialCursor(kind: Kind, mode: ScrapeMode): OlxCursor {
    if (mode === "incremental") return { kind, mode, page: 0 };
    const buckets = initialBuckets(kind);
    const [first] = buckets;
    return { kind, mode, page: 0, buckets, bucketIdx: 0, priceFrom: first![0], priceTo: first![1] };
  },

  async fetchListPage(cursor: Cursor, ctx: SourceContext): Promise<ListPage> {
    const c = cursor as OlxCursor;
    const settings: Settings = ctx.settings;
    const url = buildOlxOffersUrl({
      categoryId: OLX_CATEGORY[c.kind],
      cityId: settings.olx.cityId,
      distanceKm: settings.olx.distanceKm,
      offset: c.page * OLX_PAGE_SIZE,
      priceFrom: c.priceFrom ?? null,
      priceTo: c.priceTo ?? null,
    });
    const res = await ctx.http.get(url, OLX_JSON_HEADERS);
    if (res.status !== 200) throw new HttpError(res.status, url);
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new HttpError(res.status, url, "OLX returned non-JSON body");
    }
    const parsed = parseOlxOffersResponse(json, c.kind);
    const total = parsed.total;
    const cap = total === null ? null : Math.min(total, OLX_OFFSET_CAP);
    const nextOffset = (c.page + 1) * OLX_PAGE_SIZE;
    const hasMore = parsed.items.length > 0 && (cap === null ? parsed.hasNextLink : nextOffset < cap);
    return {
      items: parsed.items,
      total,
      totalPages: cap === null ? null : Math.ceil(cap / OLX_PAGE_SIZE),
      hasMore,
      parseErrors: parsed.parseErrors,
    };
  },

  nextCursor(cursor: Cursor, page: ListPage, info: { newCount: number }): Cursor | null {
    const c = cursor as OlxCursor;
    if (c.mode === "incremental") {
      if (info.newCount === 0 || !page.hasMore || c.page + 1 >= MAX_INCREMENTAL_PAGES) return null;
      return { ...c, page: c.page + 1 };
    }
    const buckets = c.buckets ?? initialBuckets(c.kind);
    const idx = c.bucketIdx ?? 0;
    if (c.page === 0 && page.total !== null && page.total > OLX_SPLIT_THRESHOLD) {
      const split = splitBucket(buckets, idx);
      if (split) {
        const b = split[idx]!;
        return { ...c, buckets: split, bucketIdx: idx, page: 0, priceFrom: b[0], priceTo: b[1] };
      }
    }
    if (page.hasMore) return { ...c, buckets, bucketIdx: idx, page: c.page + 1 };
    const nextIdx = idx + 1;
    const nextBucket = buckets[nextIdx];
    if (!nextBucket) return null;
    return { ...c, buckets, bucketIdx: nextIdx, page: 0, priceFrom: nextBucket[0], priceTo: nextBucket[1] };
  },
};
