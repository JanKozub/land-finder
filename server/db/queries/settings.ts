import { eq } from "drizzle-orm";
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from "../../../shared/schemas";
import type { Db } from "../client";
import { settings } from "../schema";

export async function ensureSettings(db: Db): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (row) {
    const parsed = SettingsSchema.safeParse(row.data);
    return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS, ...(row.data as Partial<Settings>) };
  }
  await db.insert(settings).values({ id: 1, data: DEFAULT_SETTINGS }).onConflictDoNothing();
  return DEFAULT_SETTINGS;
}

export const getSettings = ensureSettings;

export async function saveSettings(db: Db, data: Settings): Promise<Settings> {
  const valid = SettingsSchema.parse(data);
  await db
    .insert(settings)
    .values({ id: 1, data: valid, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.id, set: { data: valid, updatedAt: new Date() } });
  return valid;
}
