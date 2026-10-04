import type { Hono } from "hono";
import { deleteListing, listingIdsOutsideArea } from "../../db/queries/listings";
import { ensureSettings } from "../../db/queries/settings";
import type { RouteContext } from "../context";

export function registerAreaRoutes(app: Hono, ctx: RouteContext): void {
  /** How many stored listings lie outside the current rectangle (fetched before the area was narrowed). */
  app.get("/api/area/outside", async (c) => {
    const settings = await ensureSettings(ctx.db);
    const ids = await listingIdsOutsideArea(ctx.db, settings.area);
    return c.json({ count: ids.length });
  });

  /** Deletes those listings (their properties are recomputed or dropped). */
  app.post("/api/area/prune", async (c) => {
    const settings = await ensureSettings(ctx.db);
    const ids = await listingIdsOutsideArea(ctx.db, settings.area);
    const now = ctx.now();
    for (const id of ids) await deleteListing(ctx.db, id, now);
    return c.json({ deleted: ids.length });
  });
}
