import { z } from "zod";
import { AreaSchema, areaCenter, areaCoveringRadiusKm, areaFromCenter, type Area } from "./area";
import { KINDS, SOURCES, type Kind } from "./constants";

const DEFAULT_AREA: Area = areaFromCenter(49.9873, 20.0646, 15);

export const KindSchema = z.enum(KINDS);
export const SourceSchema = z.enum(SOURCES);
export const ScrapeModeSchema = z.enum(["incremental", "backfill", "sweep"]);
export type ScrapeMode = z.infer<typeof ScrapeModeSchema>;

/** Settings shared by the smaller portals: a portal-specific location token plus a radius where supported. */
export const PortalSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Location slug(s) in the portal's own URL scheme, comma-separated (the area card fills gmina lists in here). */
  location: z.string().trim().min(1).max(4000),
  /** Search radius in km for portals that support it; 0 = the location only. */
  radiusKm: z.number().int().min(0).max(100),
});
export type PortalSettings = z.infer<typeof PortalSettingsSchema>;

const portalDefault = (location: string, radiusKm = 15): PortalSettings => ({ enabled: true, location, radiusKm });

export const SettingsSchema = z.object({
  /** The search rectangle; `center` and `radiusKm` are derived from it (kept for filters, the map and notifications). */
  area: AreaSchema.default(DEFAULT_AREA),
  /** TERYT codes of gminas inside the area the user does not want to search on the portals without radius search. */
  excludedGminy: z.array(z.string().regex(/^\d{7}$/)).default([]),
  center: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  radiusKm: z.number().min(1).max(100),
  kinds: z.array(KindSchema).min(1),
  olx: z.object({
    enabled: z.boolean(),
    /** Resolved on save from the gmina at the centre of the area (OLX has no coordinate search). */
    cityId: z.number().int().positive(),
    cityName: z.string().default(""),
    distanceKm: z.number().int().min(0).max(100),
  }),
  otodom: z.object({
    enabled: z.boolean(),
    /** Location path segments as in Otodom URLs, e.g. "malopolskie/wielicki/wieliczka". */
    locationPath: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/, "Ścieżka lokalizacji Otodom: małe litery, cyfry, myślniki, ukośniki"),
    /** Any integer; Otodom honours most values but ignores some (see OTODOM_RADII), so the UI offers a check. */
    radiusKm: z.number().int().min(0).max(100),
  }),
  // Defaults keep settings saved before a portal existed loadable.
  nieruchomosci_online: PortalSettingsSchema.default(portalDefault("Wieliczka:32080")),
  morizon: PortalSettingsSchema.default({ ...portalDefault("wielicki", 0), enabled: false }),
  gratka: PortalSettingsSchema.default(portalDefault("powiat-wielicki", 0)),
  domiporta: PortalSettingsSchema.default(portalDefault("malopolskie/wieliczka")),
  adresowo: PortalSettingsSchema.default(portalDefault("powiat-wielicki", 0)),
  autoScrape: z.object({
    enabled: z.boolean(),
    intervalMin: z.number().int().min(15).max(1440),
    activeHours: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24) }),
    sweepEveryDays: z.number().int().min(1).max(30),
  }),
  alert: z.object({
    enabled: z.boolean(),
    kinds: z.array(KindSchema),
    maxPrice: z.number().int().positive().nullable(),
    minArea: z.number().positive().nullable(),
    maxPricePerM2: z.number().positive().nullable(),
    privateOnly: z.boolean(),
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** Keeps the derived centre/radius in step with the rectangle. */
export function normalizeSettings(s: Settings): Settings {
  return { ...s, center: areaCenter(s.area), radiusKm: Math.min(100, areaCoveringRadiusKm(s.area)) };
}

/** Settings rows saved before the rectangle existed get one around their centre and radius. */
export function upgradeSettingsInput(raw: unknown): unknown {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!rec || rec.area) return raw;
  const center = rec.center as { lat?: number; lon?: number } | undefined;
  const radius = typeof rec.radiusKm === "number" ? rec.radiusKm : 15;
  if (typeof center?.lat !== "number" || typeof center?.lon !== "number") return raw;
  return { ...rec, area: areaFromCenter(center.lat, center.lon, radius) };
}

export const DEFAULT_SETTINGS: Settings = {
  area: DEFAULT_AREA,
  excludedGminy: [],
  center: areaCenter(DEFAULT_AREA),
  radiusKm: areaCoveringRadiusKm(DEFAULT_AREA),
  kinds: ["plot", "house"],
  olx: { enabled: true, cityId: 128097, cityName: "Wieliczka", distanceKm: 15 },
  otodom: { enabled: true, locationPath: "malopolskie/wielicki/wieliczka", radiusKm: 15 },
  nieruchomosci_online: portalDefault("Wieliczka:32080"),
  morizon: { ...portalDefault("wielicki", 0), enabled: false },
  gratka: portalDefault("powiat-wielicki", 0),
  domiporta: portalDefault("malopolskie/wieliczka"),
  adresowo: portalDefault("powiat-wielicki", 0),
  autoScrape: { enabled: false, intervalMin: 60, activeHours: { from: 6, to: 23 }, sweepEveryDays: 1 },
  alert: { enabled: true, kinds: ["plot", "house"], maxPrice: null, minArea: null, maxPricePerM2: null, privateOnly: false },
};

export const FilterSchema = z.object({
  kinds: z.array(KindSchema).default([...KINDS]),
  priceMin: z.number().nullable().default(null),
  priceMax: z.number().nullable().default(null),
  areaMin: z.number().nullable().default(null),
  areaMax: z.number().nullable().default(null),
  pricePerM2Max: z.number().nullable().default(null),
  sources: z.array(SourceSchema).default([...SOURCES]),
  owner: z.enum(["all", "private", "agency"]).default("all"),
  addedWithinDays: z.number().int().positive().nullable().default(null),
  distanceKm: z.number().positive().nullable().default(null),
  hidden: z.enum(["exclude", "only", "include"]).default("exclude"),
  /** Properties whose every listing was ignored by the user; excluded by default. */
  ignored: z.enum(["exclude", "only", "include"]).default("exclude"),
  /** "only" narrows the view to favorites. */
  favorites: z.enum(["all", "only"]).default("all"),
  active: z.enum(["only", "include"]).default("only"),
});
export type Filters = z.infer<typeof FilterSchema>;

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const csv = (v: string | undefined): string[] | undefined =>
  v === undefined || v === "" ? undefined : v.split(",").map((s) => s.trim()).filter(Boolean);

/** Parses URL query parameters (all strings) into validated filters; unknown values fall back to defaults. */
export function parseFilterQuery(q: Record<string, string | undefined>): Filters {
  const raw = {
    kinds: csv(q.kinds),
    priceMin: num(q.priceMin),
    priceMax: num(q.priceMax),
    areaMin: num(q.areaMin),
    areaMax: num(q.areaMax),
    pricePerM2Max: num(q.pricePerM2Max),
    sources: csv(q.sources),
    owner: q.owner,
    addedWithinDays: num(q.addedWithinDays),
    distanceKm: num(q.distanceKm),
    hidden: q.hidden,
    ignored: q.ignored,
    favorites: q.favorites,
    active: q.active,
  };
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
  return parseLeniently(FilterSchema, cleaned);
}

/** Parses with the schema, dropping only the offending fields (falling back to their defaults) instead of everything. */
export function parseLeniently<T extends z.ZodObject>(schema: T, input: Record<string, unknown>): z.infer<T> {
  const first = schema.safeParse(input);
  if (first.success) return first.data;
  const bad = new Set(first.error.issues.map((i) => String(i.path[0])));
  const retry = schema.safeParse(Object.fromEntries(Object.entries(input).filter(([k]) => !bad.has(k))));
  return retry.success ? retry.data : schema.parse({});
}

export function filtersToQuery(f: Partial<Filters>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === null || v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(",") : String(v);
  }
  return out;
}

export const PropertyLinkSchema = z.object({ source: SourceSchema, url: z.string(), active: z.boolean() });
export type PropertyLink = z.infer<typeof PropertyLinkSchema>;

export type LocationPrecision = "exact" | "approx" | "unknown";

export interface PropertyDto {
  id: number;
  kind: z.infer<typeof KindSchema>;
  lat: number | null;
  lon: number | null;
  locationPrecision: LocationPrecision;
  areaM2: number | null;
  plotAreaM2: number | null;
  price: number | null;
  priceMin: number | null;
  priceMax: number | null;
  pricePerM2: number | null;
  title: string;
  city: string | null;
  district: string | null;
  isPrivate: boolean | null;
  sources: string[];
  url: string;
  links: PropertyLink[];
  listingCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  isActive: boolean;
  hidden: boolean;
  ignored: boolean;
  favorite: boolean;
  note: string | null;
}

export interface ListingDto {
  id: number;
  source: z.infer<typeof SourceSchema>;
  sourceId: string;
  kind: z.infer<typeof KindSchema>;
  url: string;
  title: string;
  price: number | null;
  priceNegotiable: boolean;
  areaM2: number | null;
  plotAreaM2: number | null;
  pricePerM2: number | null;
  plotType: string | null;
  rooms: number | null;
  lat: number | null;
  lon: number | null;
  locationPrecision: LocationPrecision;
  city: string | null;
  district: string | null;
  isPrivate: boolean | null;
  advertiserName: string | null;
  descriptionExcerpt: string | null;
  attributes: Record<string, unknown>;
  sourceCreatedAt: string | null;
  sourceRefreshedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  isActive: boolean;
  ignored: boolean;
  ignoredAt: string | null;
  pinned: boolean;
  priceHistory: { price: number; observedAt: string }[];
}

export interface PropertyDetailDto extends PropertyDto {
  listings: ListingDto[];
}

export interface RunStats {
  requests?: number;
  pages?: number;
  newListings?: number;
  updatedListings?: number;
  newProperties?: number;
  deactivated?: number;
  enriched?: number;
  /** Listings skipped or removed because their coordinates fall outside the search area. */
  outsideArea?: number;
  errors?: string[];
}

export interface RunDto {
  id: number;
  trigger: "manual" | "schedule" | "cli";
  mode: ScrapeMode;
  status: "running" | "done" | "partial" | "failed" | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  stats: RunStats;
  error: string | null;
}

export interface JobDto {
  id: number;
  runId: number;
  type: "list" | "enrich" | "sweep";
  source: z.infer<typeof SourceSchema>;
  kind: z.infer<typeof KindSchema> | null;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  attempts: number;
  notBefore: string;
  lastError: string | null;
  cursor: Record<string, unknown> | null;
}

export interface SourceStateDto {
  source: z.infer<typeof SourceSchema>;
  lastRequestAt: string | null;
  lastSuccessAt: string | null;
  blockedUntil: string | null;
  consecutiveBlocks: number;
  requestsLast10Min: number;
  lastError: string | null;
  meta: Record<string, unknown>;
}

export interface ScrapeStatusDto {
  currentRun: RunDto | null;
  queue: { queued: number; running: number; done: number; failed: number };
  jobs: JobDto[];
  sources: SourceStateDto[];
  lease: { holder: string; lockedUntil: string } | null;
  counts: {
    listings: number;
    activeListings: number;
    properties: number;
    activeProperties: number;
    hidden: number;
    /** Active listings per portal and kind, to compare with the totals the portals report (`SourceStateDto.meta.totals`). */
    bySource: Record<string, Partial<Record<Kind, number>>>;
  };
}

/** Portal-reported result totals, recorded from the first list page of every run: meta.totals[kind][location]. */
export interface SourceTotals {
  [kind: string]: Record<string, { total: number; at: string }>;
}

export const LISTING_SORT_KEYS = [
  "firstSeenAt",
  "sourceCreatedAt",
  "lastSeenAt",
  "price",
  "pricePerM2",
  "areaM2",
  "plotAreaM2",
  "title",
  "city",
  "source",
  "kind",
] as const;
export type ListingSortKey = (typeof LISTING_SORT_KEYS)[number];

/** Query for the raw listings table (all offers in the database). */
export const ListingsQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  source: SourceSchema.optional(),
  kind: KindSchema.optional(),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  ignored: z.enum(["all", "hide", "only"]).default("all"),
  /** Numeric ranges (PLN, m²); rows without the value never match a bound. */
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().min(0).optional(),
  areaMin: z.coerce.number().min(0).optional(),
  areaMax: z.coerce.number().min(0).optional(),
  pricePerM2Max: z.coerce.number().min(0).optional(),
  sort: z.enum(LISTING_SORT_KEYS).default("firstSeenAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(500).default(100),
});
export type ListingsQuery = z.infer<typeof ListingsQuerySchema>;

export function parseListingsQuery(q: Record<string, string | undefined>): ListingsQuery {
  const cleaned = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ""));
  return parseLeniently(ListingsQuerySchema, cleaned);
}

export function listingsQueryToParams(q: Partial<ListingsQuery>): Record<string, string> {
  const defaults = ListingsQuerySchema.parse({});
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "" || v === defaults[k as keyof ListingsQuery]) continue;
    out[k] = String(v);
  }
  return out;
}

export interface ListingTableRowDto extends ListingDto {
  propertyId: number | null;
  propertyHidden: boolean;
}

export interface ListingsPageDto {
  rows: ListingTableRowDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** Result of ignoring/restoring every listing that matches a table filter. */
export interface BulkIgnoreResultDto {
  /** Listings whose flag actually changed. */
  updated: number;
  /** Distinct properties recomputed afterwards. */
  properties: number;
}

export const ScrapeStartSchema = z.object({
  mode: ScrapeModeSchema,
  sources: z.array(SourceSchema).optional(),
});
export const HideSchema = z.object({ hidden: z.boolean() });
export const IgnoreSchema = z.object({ ignored: z.boolean() });
export const FavoriteSchema = z.object({ favorite: z.boolean() });
export const NoteSchema = z.object({ note: z.string().max(2000).nullable() });
export const MergeSchema = z.object({ sourcePropertyId: z.number().int().positive() });
export const OtodomValidateSchema = z.object({ url: z.string().url() });
export const OlxCitySchema = z.object({ q: z.string().min(2).max(80) });
