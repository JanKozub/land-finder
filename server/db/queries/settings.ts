import { eq } from "drizzle-orm";
import { deriveSettingsFromArea } from "../../../shared/area";
import { GMINY } from "../../../shared/area-data";
import { DEFAULT_SETTINGS, SettingsSchema, normalizeSettings, upgradeSettingsInput, type Settings } from "../../../shared/schemas";
import type { Db } from "../client";
import { settings } from "../schema";

let seed: Settings | undefined;

/** Defaults with every portal query derived from the default rectangle, so a fresh database behaves like one saved once. */
export function seedSettings(): Settings {
  seed ??= normalizeSettings(deriveSettingsFromArea(DEFAULT_SETTINGS, GMINY) ?? DEFAULT_SETTINGS);
  return seed;
}

/**
 * Validates a stored settings row. When a field no longer passes the schema (a rule tightened, a portal block saved by
 * an older build), only that field falls back to its default; the rest of the row is kept. Never returns invalid data.
 */
export function repairSettings(raw: unknown): Settings {
  const upgraded = upgradeSettingsInput(raw);
  const first = SettingsSchema.safeParse(upgraded);
  if (first.success) return first.data;
  const rec = upgraded && typeof upgraded === "object" ? (upgraded as Record<string, unknown>) : {};
  const defaults = seedSettings() as unknown as Record<string, unknown>;
  const patched: Record<string, unknown> = { ...rec };
  for (const issue of first.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string") patched[key] = defaults[key];
  }
  const second = SettingsSchema.safeParse(patched);
  return second.success ? second.data : seedSettings();
}

export async function ensureSettings(db: Db): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (row) return normalizeSettings(repairSettings(row.data));
  const initial = seedSettings();
  await db.insert(settings).values({ id: 1, data: initial }).onConflictDoNothing();
  return initial;
}

export const getSettings = ensureSettings;

export async function saveSettings(db: Db, data: Settings): Promise<Settings> {
  const valid = normalizeSettings(SettingsSchema.parse(upgradeSettingsInput(data)));
  await db
    .insert(settings)
    .values({ id: 1, data: valid, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.id, set: { data: valid, updatedAt: new Date() } });
  return valid;
}
