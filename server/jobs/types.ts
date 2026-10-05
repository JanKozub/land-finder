import type { RunStats } from "../../shared/schemas";
import type { Db } from "../db/client";
import type { ScrapeJobRow, ScrapeRunRow } from "../db/schema";
import type { SourceAdapter, SourceContext } from "../sources/types";

export interface HandlerResult {
  status: "done" | "paused" | "failed";
  cursor?: Record<string, unknown> | null;
  notBefore?: Date;
  stats: RunStats;
  error?: string;
}

export interface HandlerDeps {
  db: Db;
  adapter: SourceAdapter;
  job: ScrapeJobRow;
  run: ScrapeRunRow;
  ctx: SourceContext;
  now: () => Date;
  remainingMs: () => number;
  suppressNotifications: boolean;
  /** How many ad pages an enrich job may have in flight at once (default 1). */
  enrichConcurrency?: number;
}

export function emptyStats(): RunStats {
  return { requests: 0, pages: 0, newListings: 0, updatedListings: 0, newProperties: 0, deactivated: 0, enriched: 0, errors: [] };
}
