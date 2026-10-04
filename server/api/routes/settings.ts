import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { areaCenter, deriveSettingsFromArea, gminaAt } from "../../../shared/area";
import { GMINY } from "../../../shared/area-data";
import { OTODOM_ESTATE } from "../../../shared/constants";
import { OlxCitySchema, OtodomValidateSchema, SettingsSchema, type Settings } from "../../../shared/schemas";
import { ensureSettings, saveSettings } from "../../db/queries/settings";
import { resolveOlxCity } from "../../sources/olx/resolve-city";
import { probeOtodomTotal } from "../../sources/otodom/probe";
import { parseOtodomSearchUrl } from "../../sources/otodom/search-url";
import type { RouteContext } from "../context";
import { ApiError } from "../errors";

/** OLX searches by city id: look it up for the gmina at the centre of the area, keeping the old id if the lookup fails. */
async function withOlxCity(ctx: RouteContext, settings: Settings): Promise<Settings> {
  const center = areaCenter(settings.area);
  const home = gminaAt(GMINY, center.lat, center.lon);
  if (!home) return settings;
  try {
    const candidates = await resolveOlxCity(ctx.olxFetchClient, home.name);
    const norm = (s: string) => s.trim().toLowerCase();
    const hit = candidates.find((cand) => norm(cand.name) === norm(home.name)) ?? candidates[0];
    if (hit) return { ...settings, olx: { ...settings.olx, cityId: hit.id, cityName: hit.name } };
  } catch (err) {
    ctx.log.warn("olx city lookup failed; keeping the previous id", { town: home.name, err: err instanceof Error ? err.message : String(err) });
  }
  return { ...settings, olx: { ...settings.olx, cityName: settings.olx.cityName || home.name } };
}

export function registerSettingsRoutes(app: Hono, ctx: RouteContext): void {
  app.get("/api/settings", async (c) => c.json(await ensureSettings(ctx.db)));

  app.put("/api/settings", zValidator("json", SettingsSchema), async (c) => {
    const input = c.req.valid("json");
    const derived = deriveSettingsFromArea(input, GMINY) ?? input;
    const saved = await saveSettings(ctx.db, await withOlxCity(ctx, derived));
    return c.json(saved);
  });

  app.get("/api/olx/cities", async (c) => {
    const parsed = OlxCitySchema.safeParse({ q: c.req.query("q") ?? "" });
    if (!parsed.success) throw new ApiError(400, "invalid_query");
    const candidates = await resolveOlxCity(ctx.olxFetchClient, parsed.data.q);
    return c.json({ candidates });
  });

  app.post("/api/otodom/validate-url", zValidator("json", OtodomValidateSchema), async (c) => {
    const parsed = parseOtodomSearchUrl(c.req.valid("json").url);
    if (!parsed || !parsed.locationPath) throw new ApiError(400, "not_a_search_url");
    const radius = parsed.radiusKm !== null && Number.isInteger(parsed.radiusKm) && parsed.radiusKm >= 0 && parsed.radiusKm <= 100 ? parsed.radiusKm : 15;
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
