import { and, asc, eq, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";
import type { Settings } from "../../shared/schemas";
import type { Db } from "../db/client";
import { logNotification } from "../db/queries/notifications";
import { properties } from "../db/schema";
import { alertFilters, propertyWhere } from "../filters/where";
import type { Logger } from "../logger";
import { formatDigest, formatSummary } from "./format";
import type { Notifier } from "./types";

export const DIGEST_CHUNK = 10;
/** Above this many new offers in one run, send a single summary instead of a flood of digests. */
export const MAX_DETAILED = 40;
const MAX_AGE_DAYS = 3;
const UNKNOWN_LOCATION_GRACE_MS = 2 * 60 * 60 * 1000;
const MAX_PER_RUN = 200;

export interface NotifyOptions {
  settings: Settings;
  notifiers: Notifier[];
  appBaseUrl: string;
  runId: number | null;
  now: Date;
  log: Logger;
}

/** Sends digests for properties not yet notified that match the alert criteria; marks them notified on success. */
export async function notifyNewProperties(db: Db, opts: NotifyOptions): Promise<{ notified: number; messages: number }> {
  const configured = opts.notifiers.filter((n) => n.isConfigured());
  if (!opts.settings.alert.enabled || configured.length === 0) return { notified: 0, messages: 0 };
  const where = and(
    propertyWhere(alertFilters(opts.settings), opts.settings.center, opts.now),
    isNull(properties.notifiedAt),
    eq(properties.hidden, false),
    eq(properties.isActive, true),
    gte(properties.firstSeenAt, new Date(opts.now.getTime() - MAX_AGE_DAYS * 86_400_000)),
    or(ne(properties.locationPrecision, "unknown"), lt(properties.firstSeenAt, new Date(opts.now.getTime() - UNKNOWN_LOCATION_GRACE_MS))),
  );
  const rows = await db.select().from(properties).where(where).orderBy(asc(properties.firstSeenAt)).limit(MAX_PER_RUN);
  if (rows.length === 0) return { notified: 0, messages: 0 };

  if (rows.length > MAX_DETAILED) {
    const text = formatSummary(rows.length, opts.appBaseUrl);
    const ids = rows.map((p) => p.id);
    let sent = false;
    for (const notifier of configured) {
      try {
        await notifier.send(text);
        sent = true;
        await logNotification(db, { channel: notifier.id, runId: opts.runId, propertyIds: ids, status: "sent", sentAt: opts.now });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.log.error("notification failed", { notifier: notifier.id, error: message });
        await logNotification(db, { channel: notifier.id, runId: opts.runId, propertyIds: ids, status: "failed", error: message, sentAt: opts.now });
      }
    }
    if (sent) await db.update(properties).set({ notifiedAt: opts.now }).where(inArray(properties.id, ids));
    return { notified: sent ? ids.length : 0, messages: sent ? 1 : 0 };
  }

  const chunks: (typeof rows)[] = [];
  for (let i = 0; i < rows.length; i += DIGEST_CHUNK) chunks.push(rows.slice(i, i + DIGEST_CHUNK));
  const sentIds = new Set<number>();
  let messages = 0;
  for (const notifier of configured) {
    for (const [i, chunk] of chunks.entries()) {
      const text = formatDigest(chunk, {
        appBaseUrl: opts.appBaseUrl,
        center: opts.settings.center,
        total: rows.length,
        chunkIndex: i,
        chunkCount: chunks.length,
      });
      const ids = chunk.map((p) => p.id);
      try {
        await notifier.send(text);
        messages += 1;
        for (const id of ids) sentIds.add(id);
        await logNotification(db, { channel: notifier.id, runId: opts.runId, propertyIds: ids, status: "sent", sentAt: opts.now });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.log.error("notification failed", { notifier: notifier.id, error: message });
        await logNotification(db, { channel: notifier.id, runId: opts.runId, propertyIds: ids, status: "failed", error: message, sentAt: opts.now });
        break; // keep the remaining properties unnotified for the next run
      }
    }
  }
  if (sentIds.size) {
    await db.update(properties).set({ notifiedAt: opts.now }).where(inArray(properties.id, [...sentIds]));
  }
  return { notified: sentIds.size, messages };
}
