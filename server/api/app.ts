import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Source } from "../../shared/constants";
import type { Db } from "../db/client";
import { env } from "../env";
import { createFetchClient, type FetchClient } from "../http/fetch-client";
import { createLogger, type Logger } from "../logger";
import { defaultNotifiers } from "../notify";
import type { Notifier } from "../notify/types";
import type { RouteContext } from "./context";
import { ApiError } from "./errors";
import { registerListingRoutes } from "./routes/listings";
import { registerNotifyRoutes } from "./routes/notify";
import { registerPropertyRoutes } from "./routes/properties";
import { registerScrapeRoutes } from "./routes/scrape";
import { registerSettingsRoutes } from "./routes/settings";

export interface AppDeps {
  db: Db;
  dbKind?: string;
  log?: Logger;
  now?: () => Date;
  fetchClient?: FetchClient;
  notifiers?: Notifier[];
  appSecret?: string;
  stepBudgetMs?: number;
  workerSources?: Source[] | null;
  appBaseUrl?: string;
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
    log.error("unhandled api error", { path: c.req.path, err: err.stack ?? err.message });
    return c.json({ error: "internal_error", message: err.message }, 500);
  });
  app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

  app.get("/api/health", async (c) => {
    await ctx.db.execute(sql`select 1`);
    return c.json({ ok: true, db: ctx.dbKind, time: ctx.now().toISOString() });
  });

  registerPropertyRoutes(app, ctx);
  registerListingRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerScrapeRoutes(app, ctx);
  registerNotifyRoutes(app, ctx);
  return app;
}
