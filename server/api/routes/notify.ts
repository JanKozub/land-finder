import type { Hono } from "hono";
import { listNotifications } from "../../db/queries/notifications";
import { formatTestMessage } from "../../notify/format";
import type { RouteContext } from "../context";
import { ApiError } from "../errors";

export function registerNotifyRoutes(app: Hono, ctx: RouteContext): void {
  app.post("/api/notify/test", async (c) => {
    const configured = ctx.notifiers.filter((n) => n.isConfigured());
    if (configured.length === 0) throw new ApiError(400, "not_configured", { hint: "Ustaw TELEGRAM_BOT_TOKEN i TELEGRAM_CHAT_ID" });
    const sent: string[] = [];
    for (const n of configured) {
      await n.send(formatTestMessage());
      sent.push(n.id);
    }
    return c.json({ sent });
  });

  app.get("/api/notifications", async (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
    const rows = await listNotifications(ctx.db, limit);
    return c.json({
      notifications: rows.map((r) => ({ ...r, sentAt: r.sentAt.toISOString() })),
      configured: ctx.notifiers.filter((n) => n.isConfigured()).map((n) => n.id),
    });
  });
}
