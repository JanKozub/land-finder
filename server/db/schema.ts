import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Kind, Source } from "../../shared/constants";
import type { LocationPrecision, PropertyLink, RunStats, ScrapeMode, Settings } from "../../shared/schemas";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const settings = pgTable("settings", {
  id: integer("id").primaryKey(),
  data: jsonb("data").$type<Settings>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const sourceState = pgTable("source_state", {
  source: text("source").$type<Source>().primaryKey(),
  lastRequestAt: ts("last_request_at"),
  /** ISO timestamps of requests in the last 10 minutes (sliding window for the rate limiter). */
  requestsWindow: jsonb("requests_window").$type<string[]>().notNull().default([]),
  blockedUntil: ts("blocked_until"),
  consecutiveBlocks: integer("consecutive_blocks").notNull().default(0),
  lastSuccessAt: ts("last_success_at"),
  lastError: text("last_error"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const properties = pgTable(
  "properties",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").$type<Kind>().notNull(),
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    locationPrecision: text("location_precision").$type<LocationPrecision>().notNull().default("unknown"),
    locationRadiusKm: real("location_radius_km"),
    areaM2: real("area_m2"),
    plotAreaM2: real("plot_area_m2"),
    price: integer("price"),
    priceMin: integer("price_min"),
    priceMax: integer("price_max"),
    pricePerM2: real("price_per_m2"),
    title: text("title").notNull(),
    city: text("city"),
    district: text("district"),
    isPrivate: boolean("is_private"),
    sources: text("sources").array().notNull().default(sql`'{}'::text[]`),
    primaryUrl: text("primary_url").notNull(),
    links: jsonb("links").$type<PropertyLink[]>().notNull().default([]),
    listingCount: integer("listing_count").notNull().default(1),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    isActive: boolean("is_active").notNull().default(true),
    hidden: boolean("hidden").notNull().default(false),
    hiddenAt: ts("hidden_at"),
    /** True when every listing of the property is ignored. */
    ignored: boolean("ignored").notNull().default(false),
    favorite: boolean("favorite").notNull().default(false),
    favoriteAt: ts("favorite_at"),
    note: text("note"),
    notifiedAt: ts("notified_at"),
    manual: boolean("manual").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("properties_hidden_active_idx").on(t.hidden, t.isActive),
    index("properties_ignored_idx").on(t.ignored),
    index("properties_favorite_idx").on(t.favorite).where(sql`${t.favorite}`),
    index("properties_kind_idx").on(t.kind),
    index("properties_lat_lon_idx").on(t.lat, t.lon),
    index("properties_first_seen_idx").on(t.firstSeenAt),
    index("properties_unnotified_idx")
      .on(t.id)
      .where(sql`${t.notifiedAt} IS NULL AND NOT ${t.hidden}`),
  ],
);

export const listings = pgTable(
  "listings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: text("source").$type<Source>().notNull(),
    sourceId: text("source_id").notNull(),
    propertyId: bigint("property_id", { mode: "number" }).references(() => properties.id, { onDelete: "set null" }),
    pinned: boolean("pinned").notNull().default(false),
    url: text("url").notNull(),
    title: text("title").notNull(),
    titleNorm: text("title_norm").notNull().default(""),
    kind: text("kind").$type<Kind>().notNull(),
    price: integer("price"),
    priceNegotiable: boolean("price_negotiable").notNull().default(false),
    pricePerM2: real("price_per_m2"),
    areaM2: real("area_m2"),
    plotAreaM2: real("plot_area_m2"),
    rooms: smallint("rooms"),
    plotType: text("plot_type"),
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    locationPrecision: text("location_precision").$type<LocationPrecision>().notNull().default("unknown"),
    locationRadiusKm: real("location_radius_km"),
    city: text("city"),
    district: text("district"),
    region: text("region"),
    isPrivate: boolean("is_private"),
    advertiserName: text("advertiser_name"),
    advertiserId: text("advertiser_id"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    descriptionExcerpt: text("description_excerpt"),
    sourceCreatedAt: ts("source_created_at"),
    sourceRefreshedAt: ts("source_refreshed_at"),
    validTo: ts("valid_to"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: ts("deactivated_at"),
    /** Manually ignored by the user; excluded from the map by default and from property aggregates. */
    ignored: boolean("ignored").notNull().default(false),
    ignoredAt: ts("ignored_at"),
    enrichedAt: ts("enriched_at"),
    enrichAttempts: smallint("enrich_attempts").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("listings_source_source_id_uq").on(t.source, t.sourceId),
    index("listings_property_idx").on(t.propertyId),
    index("listings_kind_lat_lon_idx").on(t.kind, t.lat, t.lon),
    index("listings_last_seen_idx").on(t.lastSeenAt),
    index("listings_needs_enrich_idx")
      .on(t.source, t.firstSeenAt)
      .where(sql`${t.lat} IS NULL AND ${t.isActive}`),
  ],
);

export const dedupExclusions = pgTable(
  "dedup_exclusions",
  {
    listingIdA: bigint("listing_id_a", { mode: "number" })
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    listingIdB: bigint("listing_id_b", { mode: "number" })
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.listingIdA, t.listingIdB] }),
    check("dedup_exclusions_order", sql`${t.listingIdA} < ${t.listingIdB}`),
  ],
);

export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: serial("id").primaryKey(),
    trigger: text("trigger").$type<"manual" | "schedule" | "cli">().notNull(),
    mode: text("mode").$type<ScrapeMode>().notNull(),
    status: text("status").$type<"running" | "done" | "partial" | "failed" | "cancelled">().notNull().default("running"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    stats: jsonb("stats").$type<RunStats>().notNull().default({}),
    error: text("error"),
  },
  (t) => [index("scrape_runs_started_idx").on(t.startedAt)],
);

export const scrapeJobs = pgTable(
  "scrape_jobs",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => scrapeRuns.id, { onDelete: "cascade" }),
    type: text("type").$type<"list" | "enrich" | "sweep">().notNull(),
    source: text("source").$type<Source>().notNull(),
    kind: text("kind").$type<Kind>(),
    status: text("status").$type<"queued" | "running" | "done" | "failed" | "cancelled">().notNull().default("queued"),
    priority: smallint("priority").notNull().default(100),
    cursor: jsonb("cursor").$type<Record<string, unknown>>(),
    attempts: smallint("attempts").notNull().default(0),
    maxAttempts: smallint("max_attempts").notNull().default(3),
    notBefore: ts("not_before").notNull().defaultNow(),
    suppressNotifications: boolean("suppress_notifications").notNull().default(false),
    stats: jsonb("stats").$type<RunStats>().notNull().default({}),
    lastError: text("last_error"),
    createdAt: ts("created_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("scrape_jobs_claim_idx").on(t.status, t.notBefore, t.priority, t.id),
    index("scrape_jobs_run_idx").on(t.runId),
  ],
);

export const workerLease = pgTable("worker_lease", {
  id: integer("id").primaryKey(),
  holder: text("holder").notNull(),
  lockedUntil: ts("locked_until").notNull(),
  heartbeatAt: ts("heartbeat_at").notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(),
  runId: integer("run_id"),
  propertyIds: bigint("property_ids", { mode: "number" }).array().notNull().default(sql`'{}'::bigint[]`),
  status: text("status").$type<"sent" | "failed">().notNull(),
  error: text("error"),
  sentAt: ts("sent_at").notNull().defaultNow(),
});

export const priceHistory = pgTable(
  "price_history",
  {
    id: serial("id").primaryKey(),
    listingId: bigint("listing_id", { mode: "number" })
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    price: integer("price").notNull(),
    observedAt: ts("observed_at").notNull().defaultNow(),
  },
  (t) => [index("price_history_listing_idx").on(t.listingId, t.observedAt)],
);

export type ListingRow = typeof listings.$inferSelect;
export type NewListingRow = typeof listings.$inferInsert;
export type PropertyRow = typeof properties.$inferSelect;
export type ScrapeRunRow = typeof scrapeRuns.$inferSelect;
export type ScrapeJobRow = typeof scrapeJobs.$inferSelect;
export type SourceStateRow = typeof sourceState.$inferSelect;
