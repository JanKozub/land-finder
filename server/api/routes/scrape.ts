import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { ScrapeStartSchema } from "../../../shared/schemas";
import { cancelOpenJobs, listRuns } from "../../db/queries/jobs";
import { ensureSettings } from "../../db/queries/settings";
import { startRun } from "../../jobs/plans";
import { runWorker } from "../../jobs/worker";
import type { RouteContext } from "../context";
import { runToDto } from "../dto";
import { buildStatus } from "../status";

export function registerScrapeRoutes(app: Hono, ctx: RouteContext): void {
  app.post("/api/scrape", zValidator("json", ScrapeStartSchema), async (c) => {
    const body = c.req.valid("json");
    const settings = await ensureSettings(ctx.db);
    const result = await startRun(ctx.db, {
      mode: body.mode,
      trigger: "manual",
      sources: body.sources ?? null,
      settings,
      now: ctx.now(),
    });
    if (!result.ok) return c.json({ error: result.reason, run: result.run ? runToDto(result.run) : null }, 409);
    return c.json({ run: runToDto(result.run), jobs: result.jobs.length }, 201);
  });

  app.get("/api/scrape/status", async (c) => c.json(await buildStatus(ctx.db, ctx.now())));

  app.get("/api/scrape/runs", async (c) => {
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 20) || 20));
    const runs = await listRuns(ctx.db, limit);
    return c.json({ runs: runs.map(runToDto) });
  });

  app.post("/api/scrape/cancel", async (c) => {
    const cancelled = await cancelOpenJobs(ctx.db, ctx.now());
    return c.json({ cancelled });
  });

  app.post("/api/worker/slice", async (c) => {
    const summary = await runWorker({
      db: ctx.db,
      budgetMs: ctx.stepBudgetMs,
      holder: `api-${randomUUID().slice(0, 8)}`,
      sources: ctx.workerSources,
      log: ctx.log.child({ mod: "worker" }),
      fetchClient: ctx.fetchClient,
      notifiers: ctx.notifiers,
      appBaseUrl: ctx.appBaseUrl,
      now: ctx.now,
    });
    const status = await buildStatus(ctx.db, ctx.now());
    return c.json({ summary, status });
  });
}
