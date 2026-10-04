import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Source } from "../../shared/constants";
import type { Db } from "../db/client";
import { env } from "../env";
import { clientForSource } from "../http/clients";
import { createFetchClient, type FetchClient } from "../http/fetch-client";
import { createLogger, type Logger } from "../logger";
import { defaultNotifiers } from "../notify";
import type { Notifier } from "../notify/types";
import type { RouteContext } from "./context";
import { ApiError } from "./errors";
import { registerAreaRoutes } from "./routes/area";
import { registerListingRoutes } from "./routes/listings";
import { registerNotifyRoutes } from "./routes/notify";
import { registerPropertyRoutes } from "./routes/properties";
import { registerScrapeRoutes } from "./routes/scrape";
import { registerSettingsRoutes } from "./routes/settings";
import { registerSourceRoutes } from "./routes/sources";

export interface AppDeps {
  db: Db;
  dbKind?: string;
  log?: Logger;
  now?: () => Date;
  fetchClient?: FetchClient;
  olxFetchClient?: FetchClient;
  notifiers?: Notifier[];
  appSecret?: string;
  stepBudgetMs?: number;
  workerSources?: Source[] | null;
  appBaseUrl?: string;
}

/** Drivers and ORMs wrap the real error (e.g. drizzle's "Failed query"); surface the chain of causes. */
export function describeCause(err: unknown): string | null {
  const parts: string[] = [];
  let current: unknown = err instanceof Error ? err.cause : null;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const e = current as { message?: unknown; code?: unknown; cause?: unknown };
    const message = typeof e.message === "string" ? e.message : String(current);
    parts.push(typeof e.code === "string" ? `${e.code}: ${message}` : message);
    current = e.cause;
  }
  return parts.length ? parts.join(" ← ") : null;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const log = deps.log ?? createLogger({ mod: "api" });
  const ctx: RouteContext = {
    db: deps.db,
    dbKind: deps.dbKind ?? "unknown",
    log,
    now: deps.now ?? (() => new Date()),
    fetchClient: deps.fetchClient ?? createFetchClient(),
    olxFetchClient: deps.olxFetchClient ?? clientForSource("olx", deps.fetchClient ?? createFetchClient()),
    notifiers: deps.notifiers ?? defaultNotifiers(),
    stepBudgetMs: deps.stepBudgetMs ?? env.stepBudgetMs,
    workerSources: deps.workerSources === undefined ? (env.workerSources as Source[] | null) : deps.workerSources,
    appBaseUrl: deps.appBaseUrl ?? env.appBaseUrl,
  };
  const secret = deps.appSecret ?? env.appSecret;

  app.use("/api/*", async (c, next) => {
    if (secret && c.req.method !== "GET" && c.req.header("x-app-secret") !== secret) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.message, ...err.extra }, err.status as ContentfulStatusCode);
    if (err instanceof HTTPException) return err.getResponse();
    const cause = describeCause(err);
    log.error("unhandled api error", { path: c.req.path, err: err.stack ?? err.message, cause });
    return c.json({ error: "internal_error", message: cause ? `${err.message} — ${cause}` : err.message }, 500);
  });
  app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

  app.get("/api/health", async (c) => {
    await ctx.db.execute(sql`select 1`);
    // Does the schema exist? (migrations applied) — checked via the settings table.
    const rows = (await ctx.db.select({ ready: sql<boolean>`to_regclass('public.settings') is not null` }).from(sql`(select 1) as probe`)) as { ready: boolean }[];
    let dbHost: string | null = null;
    try {
      dbHost = env.databaseUrl.startsWith("pglite://") ? "pglite (local file)" : new URL(env.databaseUrl).hostname;
    } catch {
      dbHost = null;
    }
    return c.json({ ok: true, db: ctx.dbKind, dbHost, schemaReady: rows[0]?.ready === true, time: ctx.now().toISOString() });
  });

  registerPropertyRoutes(app, ctx);
  registerListingRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerScrapeRoutes(app, ctx);
  registerSourceRoutes(app, ctx);
  registerNotifyRoutes(app, ctx);
  registerAreaRoutes(app, ctx);
  return app;
}
