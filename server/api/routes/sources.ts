import type { Hono } from "hono";
import { SOURCES, type Source } from "../../../shared/constants";
import { ensureSettings } from "../../db/queries/settings";
import { getSourceState, updateSourceState } from "../../db/queries/source-state";
import { env } from "../../env";
import { clientForSource } from "../../http/clients";
import { adapterFor } from "../../sources";
import type { RouteContext } from "../context";
import { sourceStateToDto } from "../dto";
import { ApiError } from "../errors";

function parseSource(raw: string | undefined): Source {
  if (!raw || !(SOURCES as readonly string[]).includes(raw)) throw new ApiError(400, "unknown_source");
  return raw as Source;
}

export function registerSourceRoutes(app: Hono, ctx: RouteContext): void {
  /** One real request to the portal, outside the rate limiter, so the user can see whether it is reachable. */
  app.get("/api/sources/:source/probe", async (c) => {
    const source = parseSource(c.req.param("source"));
    const settings = await ensureSettings(ctx.db);
    const probe = adapterFor(source).probe?.(settings);
    if (!probe) throw new ApiError(400, "probe_unsupported");
    const url = probe.url;
    const client = clientForSource(source, ctx.fetchClient, ctx.olxFetchClient);
    const started = Date.now();
    let status = 0;
    let error: string | null = null;
    let server: string | null = null;
    try {
      const res = await client.get(url, probe.headers);
      status = res.status;
      server = res.headers.get("server");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const state = await getSourceState(ctx.db, source);
    return c.json({
      source,
      ok: status === 200,
      status,
      server,
      error,
      ms: Date.now() - started,
      viaProxy: source === "olx" && Boolean(env.olxProxyUrl),
      state: sourceStateToDto(state, ctx.now()),
    });
  });

  /** Clears the app-side backoff (blocked_until) after the user verified the portal responds again. */
  app.post("/api/sources/:source/reset", async (c) => {
    const source = parseSource(c.req.param("source"));
    await updateSourceState(ctx.db, source, { blockedUntil: null, consecutiveBlocks: 0, lastError: null, requestsWindow: [] });
    return c.json(sourceStateToDto(await getSourceState(ctx.db, source), ctx.now()));
  });
}
