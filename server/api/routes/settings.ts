import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { OTODOM_ESTATE, OTODOM_RADII } from "../../../shared/constants";
import { OlxCitySchema, OtodomValidateSchema, SettingsSchema } from "../../../shared/schemas";
import { ensureSettings, saveSettings } from "../../db/queries/settings";
import { resolveOlxCity } from "../../sources/olx/resolve-city";
import { probeOtodomTotal } from "../../sources/otodom/probe";
import { parseOtodomSearchUrl } from "../../sources/otodom/search-url";
import type { RouteContext } from "../context";
import { ApiError } from "../errors";

export function registerSettingsRoutes(app: Hono, ctx: RouteContext): void {
  app.get("/api/settings", async (c) => c.json(await ensureSettings(ctx.db)));

  app.put("/api/settings", zValidator("json", SettingsSchema), async (c) => {
    const saved = await saveSettings(ctx.db, c.req.valid("json"));
    return c.json(saved);
  });

  app.get("/api/olx/cities", async (c) => {
    const parsed = OlxCitySchema.safeParse({ q: c.req.query("q") ?? "" });
    if (!parsed.success) throw new ApiError(400, "invalid_query");
    const candidates = await resolveOlxCity(ctx.fetchClient, parsed.data.q);
    return c.json({ candidates });
  });

  app.post("/api/otodom/validate-url", zValidator("json", OtodomValidateSchema), async (c) => {
    const parsed = parseOtodomSearchUrl(c.req.valid("json").url);
    if (!parsed || !parsed.locationPath) throw new ApiError(400, "not_a_search_url");
    const radius = parsed.radiusKm !== null && (OTODOM_RADII as readonly number[]).includes(parsed.radiusKm) ? parsed.radiusKm : 15;
    const estate = parsed.estate ?? OTODOM_ESTATE.plot;
    const [withRadius, noRadius] = await Promise.all([
      probeOtodomTotal(ctx.fetchClient, { estate, locationPath: parsed.locationPath, radiusKm: radius }),
      radius > 0 ? probeOtodomTotal(ctx.fetchClient, { estate, locationPath: parsed.locationPath, radiusKm: 0 }) : Promise.resolve(null),
    ]);
    const radiusIgnored = radius > 0 && withRadius !== null && noRadius !== null && withRadius === noRadius;
    let suggestedPath: string | null = null;
    let suggestedTotal: number | null = null;
    const segments = parsed.locationPath.split("/");
    if (radiusIgnored && segments.length >= 2) {
      suggestedPath = segments.slice(0, -1).join("/");
      suggestedTotal = await probeOtodomTotal(ctx.fetchClient, { estate, locationPath: suggestedPath, radiusKm: radius });
    }
    return c.json({
      locationPath: parsed.locationPath,
      estate,
      radiusKm: radius,
      totalWithRadius: withRadius,
      totalWithoutRadius: noRadius,
      radiusIgnored,
      suggestedPath,
      suggestedTotal,
    });
  });
}
