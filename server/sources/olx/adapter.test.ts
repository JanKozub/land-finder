import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../../shared/schemas";
import type { ListPage } from "../types";
import { initialBuckets, olxAdapter, splitBucket, type OlxCursor } from "./adapter";

const page = (over: Partial<ListPage>): ListPage => ({ items: [], total: 100, totalPages: 2, hasMore: true, parseErrors: 0, ...over });

describe("OLX adapter cursors", () => {
  it("incremental stops when a page brings nothing new or has no more pages", () => {
    const c = olxAdapter.initialCursor("plot", "incremental", DEFAULT_SETTINGS);
    expect(c).toEqual({ kind: "plot", mode: "incremental", page: 0 });
    expect(olxAdapter.nextCursor(c, page({ hasMore: true }), { newCount: 5 })).toMatchObject({ page: 1 });
    expect(olxAdapter.nextCursor(c, page({ hasMore: true }), { newCount: 0 })).toBeNull();
    expect(olxAdapter.nextCursor(c, page({ hasMore: false }), { newCount: 5 })).toBeNull();
    expect(olxAdapter.nextCursor({ ...c, page: 4 }, page({ hasMore: true }), { newCount: 5 })).toBeNull();
  });

  it("backfill walks pages, then buckets, splitting buckets that exceed the cap", () => {
    const c = olxAdapter.initialCursor("plot", "backfill", DEFAULT_SETTINGS) as OlxCursor;
    expect(c.buckets).toEqual(initialBuckets("plot"));
    expect(c).toMatchObject({ page: 0, bucketIdx: 0, priceFrom: 0, priceTo: 50_000 });

    const next = olxAdapter.nextCursor(c, page({ hasMore: true, total: 120 }), { newCount: 50 }) as OlxCursor;
    expect(next).toMatchObject({ page: 1, bucketIdx: 0 });
    const afterBucket = olxAdapter.nextCursor(next, page({ hasMore: false, total: 120 }), { newCount: 50 }) as OlxCursor;
    expect(afterBucket).toMatchObject({ page: 0, bucketIdx: 1, priceFrom: 50_000, priceTo: 100_000 });

    const split = olxAdapter.nextCursor(c, page({ hasMore: true, total: 1000 }), { newCount: 50 }) as OlxCursor;
    expect(split).toMatchObject({ page: 0, bucketIdx: 0, priceFrom: 0, priceTo: 25_000 });
    expect(split.buckets).toHaveLength(initialBuckets("plot").length + 1);

    const last = { ...c, bucketIdx: c.buckets!.length - 1, page: 3 } as OlxCursor;
    expect(olxAdapter.nextCursor(last, page({ hasMore: false }), { newCount: 1 })).toBeNull();
  });

  it("splits the open-ended bucket and refuses to split tiny ones", () => {
    const buckets = initialBuckets("house");
    const open = splitBucket(buckets, buckets.length - 1)!;
    expect(open[open.length - 2]).toEqual([2_500_000, 5_000_000]);
    expect(open[open.length - 1]).toEqual([5_000_000, null]);
    expect(splitBucket([[0, 15_000]], 0)).toBeNull();
  });
});
