import type { Kind, Source } from "../../shared/constants";
import type { LocationPrecision, ScrapeMode, Settings } from "../../shared/schemas";
import type { ListingRow } from "../db/schema";
import type { RateConfig, SourceHttp } from "../http/rate-limiter";
import type { Logger } from "../logger";

/** A listing as parsed from a portal, independent of storage. */
export interface NormalizedListing {
  source: Source;
  sourceId: string;
  /** Absolute https link to the original ad. Mandatory. */
  url: string;
  title: string;
  kind: Kind;
  price: number | null;
  priceNegotiable: boolean;
  /** Plot: plot area. House: living area. */
  areaM2: number | null;
  /** House: plot area. */
  plotAreaM2: number | null;
  pricePerM2: number | null;
  rooms: number | null;
  plotType: string | null;
  lat: number | null;
  lon: number | null;
  locationPrecision: LocationPrecision;
  locationRadiusKm: number | null;
  city: string | null;
  district: string | null;
  region: string | null;
  isPrivate: boolean | null;
  advertiserName: string | null;
  advertiserId: string | null;
  attributes: Record<string, unknown>;
  descriptionExcerpt: string | null;
  sourceCreatedAt: Date | null;
  sourceRefreshedAt: Date | null;
  validTo: Date | null;
}

export interface Cursor {
  kind: Kind;
  mode: ScrapeMode;
  page: number;
  [key: string]: unknown;
}

export interface ListPage {
  items: NormalizedListing[];
  total: number | null;
  totalPages: number | null;
  hasMore: boolean;
  parseErrors: number;
}

export interface SourceContext {
  http: SourceHttp;
  settings: Settings;
  /** Per-source persisted metadata (e.g. Otodom buildId). */
  meta: Record<string, unknown>;
  setMeta(patch: Record<string, unknown>): Promise<void>;
  log: Logger;
  now(): Date;
}

export interface EnrichResult {
  status: "ok" | "gone" | "skip";
  patch?: Partial<NormalizedListing> & { isActive?: boolean };
}

export interface SourceAdapter {
  id: Source;
  label: string;
  rate: RateConfig;
  estimatedPageCostMs: number;
  estimatedEnrichCostMs?: number;
  initialCursor(kind: Kind, mode: ScrapeMode, settings: Settings): Cursor;
  fetchListPage(cursor: Cursor, ctx: SourceContext): Promise<ListPage>;
  nextCursor(cursor: Cursor, page: ListPage, info: { newCount: number }): Cursor | null;
  enrich?(listing: ListingRow, ctx: SourceContext): Promise<EnrichResult>;
}
