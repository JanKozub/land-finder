CREATE TABLE "dedup_exclusions" (
	"listing_id_a" bigint NOT NULL,
	"listing_id_b" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dedup_exclusions_listing_id_a_listing_id_b_pk" PRIMARY KEY("listing_id_a","listing_id_b"),
	CONSTRAINT "dedup_exclusions_order" CHECK ("dedup_exclusions"."listing_id_a" < "dedup_exclusions"."listing_id_b")
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"property_id" bigint,
	"pinned" boolean DEFAULT false NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"title_norm" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"price" integer,
	"price_negotiable" boolean DEFAULT false NOT NULL,
	"price_per_m2" real,
	"area_m2" real,
	"plot_area_m2" real,
	"rooms" smallint,
	"plot_type" text,
	"lat" double precision,
	"lon" double precision,
	"location_precision" text DEFAULT 'unknown' NOT NULL,
	"location_radius_km" real,
	"city" text,
	"district" text,
	"region" text,
	"is_private" boolean,
	"advertiser_name" text,
	"advertiser_id" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description_excerpt" text,
	"source_created_at" timestamp with time zone,
	"source_refreshed_at" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"enriched_at" timestamp with time zone,
	"enrich_attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"run_id" integer,
	"property_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" bigint NOT NULL,
	"price" integer NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"location_precision" text DEFAULT 'unknown' NOT NULL,
	"location_radius_km" real,
	"area_m2" real,
	"plot_area_m2" real,
	"price" integer,
	"price_min" integer,
	"price_max" integer,
	"price_per_m2" real,
	"title" text NOT NULL,
	"city" text,
	"district" text,
	"is_private" boolean,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"primary_url" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"listing_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"hidden_at" timestamp with time zone,
	"note" text,
	"notified_at" timestamp with time zone,
	"manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"kind" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" smallint DEFAULT 100 NOT NULL,
	"cursor" jsonb,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 3 NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"suppress_notifications" boolean DEFAULT false NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_state" (
	"source" text PRIMARY KEY NOT NULL,
	"last_request_at" timestamp with time zone,
	"requests_window" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked_until" timestamp with time zone,
	"consecutive_blocks" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_lease" (
	"id" integer PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dedup_exclusions" ADD CONSTRAINT "dedup_exclusions_listing_id_a_listings_id_fk" FOREIGN KEY ("listing_id_a") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dedup_exclusions" ADD CONSTRAINT "dedup_exclusions_listing_id_b_listings_id_fk" FOREIGN KEY ("listing_id_b") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_run_id_scrape_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listings_source_source_id_uq" ON "listings" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "listings_property_idx" ON "listings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "listings_kind_lat_lon_idx" ON "listings" USING btree ("kind","lat","lon");--> statement-breakpoint
CREATE INDEX "listings_last_seen_idx" ON "listings" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "listings_needs_enrich_idx" ON "listings" USING btree ("source","first_seen_at") WHERE "listings"."lat" IS NULL AND "listings"."is_active";--> statement-breakpoint
CREATE INDEX "price_history_listing_idx" ON "price_history" USING btree ("listing_id","observed_at");--> statement-breakpoint
CREATE INDEX "properties_hidden_active_idx" ON "properties" USING btree ("hidden","is_active");--> statement-breakpoint
CREATE INDEX "properties_kind_idx" ON "properties" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "properties_lat_lon_idx" ON "properties" USING btree ("lat","lon");--> statement-breakpoint
CREATE INDEX "properties_first_seen_idx" ON "properties" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "properties_unnotified_idx" ON "properties" USING btree ("id") WHERE "properties"."notified_at" IS NULL AND NOT "properties"."hidden";--> statement-breakpoint
CREATE INDEX "scrape_jobs_claim_idx" ON "scrape_jobs" USING btree ("status","not_before","priority","id");--> statement-breakpoint
CREATE INDEX "scrape_jobs_run_idx" ON "scrape_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "scrape_runs_started_idx" ON "scrape_runs" USING btree ("started_at");