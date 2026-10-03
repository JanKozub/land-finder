import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { FavoriteSchema, HideSchema, IgnoreSchema, MergeSchema, NoteSchema, parseFilterQuery } from "../../../shared/schemas";
import {
  detachListing,
  getPropertyDetail,
  listProperties,
  mergeProperties,
  propertyToDto,
  setFavorite,
  setHidden,
  setNote,
  setPropertyIgnored,
} from "../../db/queries/properties";
import { ensureSettings } from "../../db/queries/settings";
import type { RouteContext } from "../context";
import { ApiError, parseId } from "../errors";

export function registerPropertyRoutes(app: Hono, ctx: RouteContext): void {
  app.get("/api/properties", async (c) => {
    const settings = await ensureSettings(ctx.db);
    const filters = parseFilterQuery(c.req.query());
    const items = await listProperties(ctx.db, filters, settings, ctx.now());
    return c.json({ items, total: items.length, center: settings.center, radiusKm: settings.radiusKm });
  });

  app.get("/api/properties/:id", async (c) => {
    const detail = await getPropertyDetail(ctx.db, parseId(c.req.param("id")));
    if (!detail) throw new ApiError(404, "not_found");
    return c.json(detail);
  });

  app.post("/api/properties/:id/hide", zValidator("json", HideSchema), async (c) => {
    const { hidden } = c.req.valid("json");
    const row = await setHidden(ctx.db, parseId(c.req.param("id")), hidden, ctx.now());
    if (!row) throw new ApiError(404, "not_found");
    return c.json(propertyToDto(row));
  });

  app.post("/api/properties/:id/favorite", zValidator("json", FavoriteSchema), async (c) => {
    const { favorite } = c.req.valid("json");
    const row = await setFavorite(ctx.db, parseId(c.req.param("id")), favorite, ctx.now());
    if (!row) throw new ApiError(404, "not_found");
    return c.json(propertyToDto(row));
  });

  app.post("/api/properties/:id/ignore", zValidator("json", IgnoreSchema), async (c) => {
    const { ignored } = c.req.valid("json");
    const row = await setPropertyIgnored(ctx.db, parseId(c.req.param("id")), ignored, ctx.now());
    if (!row) throw new ApiError(404, "not_found");
    return c.json(propertyToDto(row));
  });

  app.patch("/api/properties/:id", zValidator("json", NoteSchema), async (c) => {
    const { note } = c.req.valid("json");
    const row = await setNote(ctx.db, parseId(c.req.param("id")), note, ctx.now());
    if (!row) throw new ApiError(404, "not_found");
    return c.json(propertyToDto(row));
  });

  app.post("/api/properties/:id/merge", zValidator("json", MergeSchema), async (c) => {
    const { sourcePropertyId } = c.req.valid("json");
    const row = await mergeProperties(ctx.db, parseId(c.req.param("id")), sourcePropertyId, ctx.now());
    if (!row) throw new ApiError(404, "not_found");
    return c.json(propertyToDto(row));
  });

  app.post("/api/listings/:id/detach", async (c) => {
    const result = await detachListing(ctx.db, parseId(c.req.param("id")), ctx.now());
    if (!result) throw new ApiError(404, "not_found");
    const detail = await getPropertyDetail(ctx.db, result.propertyId);
    return c.json({ propertyId: result.propertyId, property: detail });
  });
}
