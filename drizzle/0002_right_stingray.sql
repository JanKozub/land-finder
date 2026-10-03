ALTER TABLE "properties" ADD COLUMN "favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "favorite_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "properties_favorite_idx" ON "properties" USING btree ("favorite") WHERE "properties"."favorite";