import { describe, expect, it } from "vitest";
import { incrementalStep } from "./paging";
import type { Cursor, ListPage } from "./types";

const page = (hasMore: boolean): ListPage => ({ items: [], total: null, totalPages: null, hasMore, parseErrors: 0 });
const cursor = (o: Partial<Cursor> = {}): Cursor => ({ kind: "plot", mode: "incremental", page: 1, ...o });

describe("incremental paging", () => {
  it("continues after one page without news and stops after two", () => {
    const first = incrementalStep(cursor(), page(true), { newCount: 0 }, 1);
    expect(first).toEqual({ stop: false, emptyStreak: 1 });
    const second = incrementalStep(cursor({ page: 2, emptyStreak: 1 }), page(true), { newCount: 0 }, 2);
    expect(second.stop).toBe(true);
    const reset = incrementalStep(cursor({ page: 2, emptyStreak: 1 }), page(true), { newCount: 3 }, 2);
    expect(reset).toEqual({ stop: false, emptyStreak: 0 });
  });

  it("stops at the page cap or when the portal has no more pages; backfills only stop at the end", () => {
    expect(incrementalStep(cursor({ page: 5 }), page(true), { newCount: 10 }, 5).stop).toBe(true);
    expect(incrementalStep(cursor(), page(false), { newCount: 10 }, 1).stop).toBe(true);
    expect(incrementalStep(cursor({ mode: "backfill", page: 40 }), page(true), { newCount: 0 }, 40).stop).toBe(false);
  });
});
