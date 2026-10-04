import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { IgnoreSchema, parseListingsQuery, type BulkIgnoreResultDto, type ListingsPageDto } from "../../../shared/schemas";
import { bulkSetListingsIgnored, listListingsTable } from "../../db/queries/listings";
import { listingToDto, propertyToDto, recomputeProperties, setListingIgnored } from "../../db/queries/properties";
import type { RouteContext } from "../context";
import { ApiError, parseId } from "../errors";

export function registerListingRoutes(app: Hono, ctx: RouteContext): void {
  app.get("/api/listings", async (c) => {
    const query = parseListingsQuery(c.req.query());
    const { rows, total } = await listListingsTable(ctx.db, query);
    const body: ListingsPageDto = {
      rows: rows.map((r) => ({ ...listingToDto(r, []), propertyId: r.propertyId, propertyHidden: r.propertyHidden })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
    return c.json(body);
  });

  /** Ignores (or restores) every listing matching the same filter as GET /api/listings, across all pages. */
  app.post("/api/listings/bulk-ignore", zValidator("json", IgnoreSchema), async (c) => {
    const query = parseListingsQuery(c.req.query());
    const { ignored } = c.req.valid("json");
    const now = ctx.now();
    const { listingIds, propertyIds } = await bulkSetListingsIgnored(ctx.db, query, ignored, now);
    await recomputeProperties(ctx.db, propertyIds, now);
    const body: BulkIgnoreResultDto = { updated: listingIds.length, properties: propertyIds.length };
    return c.json(body);
  });

  app.post("/api/listings/:id/ignore", zValidator("json", IgnoreSchema), async (c) => {
    const { ignored } = c.req.valid("json");
    const result = await setListingIgnored(ctx.db, parseId(c.req.param("id")), ignored, ctx.now());
    if (!result) throw new ApiError(404, "not_found");
    return c.json({ listing: listingToDto(result.listing, []), property: result.property ? propertyToDto(result.property) : null });
  });
}
