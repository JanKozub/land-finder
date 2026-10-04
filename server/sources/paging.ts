import { MAX_INCREMENTAL_PAGES } from "../../shared/constants";
import type { Cursor, ListPage } from "./types";

/** Promoted ads and refresh-first ordering put known offers on top, so one page without news is not the end. */
export const INCREMENTAL_EMPTY_PAGES = 2;

/**
 * Whether an incremental run should fetch another page, and the updated streak of pages without new listings.
 * `pagesDone` counts pages already fetched for the current location (1-based portals: cursor.page; OLX: page + 1).
 */
export function incrementalStep(cursor: Cursor, page: ListPage, info: { newCount: number }, pagesDone: number): { stop: boolean; emptyStreak: number } {
  const emptyStreak = info.newCount > 0 ? 0 : (typeof cursor.emptyStreak === "number" ? cursor.emptyStreak : 0) + 1;
  if (!page.hasMore) return { stop: true, emptyStreak };
  if (cursor.mode !== "incremental") return { stop: false, emptyStreak };
  return { stop: emptyStreak >= INCREMENTAL_EMPTY_PAGES || pagesDone >= MAX_INCREMENTAL_PAGES, emptyStreak };
}
