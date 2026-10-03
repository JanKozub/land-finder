import { readFileSync } from "node:fs";
import { createDb, type DbHandle } from "../../server/db/client";
import { ensureSettings } from "../../server/db/queries/settings";

/** Fresh in-memory Postgres (PGlite) with migrations applied and default settings seeded. */
export async function createTestDb(): Promise<DbHandle> {
  const handle = await createDb("pglite://memory");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(handle.db as any, { migrationsFolder: "drizzle" });
  await ensureSettings(handle.db);
  return handle;
}

export function loadFixture<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(`../fixtures/${relativePath}`, import.meta.url), "utf8")) as T;
}

export function loadFixtureText(relativePath: string): string {
  return readFileSync(new URL(`../fixtures/${relativePath}`, import.meta.url), "utf8");
}
