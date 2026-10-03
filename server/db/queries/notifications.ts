import { desc } from "drizzle-orm";
import type { Db } from "../client";
import { notifications } from "../schema";

export async function logNotification(
  db: Db,
  input: { channel: string; runId: number | null; propertyIds: number[]; status: "sent" | "failed"; error?: string | null; sentAt: Date },
): Promise<void> {
  await db.insert(notifications).values({
    channel: input.channel,
    runId: input.runId,
    propertyIds: input.propertyIds,
    status: input.status,
    error: input.error ?? null,
    sentAt: input.sentAt,
  });
}

export async function listNotifications(db: Db, limit = 50) {
  return db.select().from(notifications).orderBy(desc(notifications.id)).limit(limit);
}
