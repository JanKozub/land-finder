ALTER TABLE "listings" ADD COLUMN "ignored" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "ignored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "ignored" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "properties_ignored_idx" ON "properties" USING btree ("ignored");