import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  kind: "pglite" | "postgres";
  close(): Promise<void>;
}

/**
 * Opens a database for the given URL.
 * - `postgres://…` / `postgresql://…` → postgres.js (Supabase transaction pooler friendly: no prepared statements).
 * - `pglite://<dir>` → embedded Postgres persisted in <dir>; `pglite://memory` → in-memory (tests).
 */
export async function createDb(url: string = env.databaseUrl): Promise<DbHandle> {
  if (url.startsWith("pglite://")) {
    const dir = url.slice("pglite://".length);
    // Non-literal specifiers keep esbuild from bundling (or copying) the PGlite WASM into Netlify functions;
    // the import only runs for local dev and tests.
    const pgliteModule = "@electric-sql/pglite";
    const drizzlePgliteModule = "drizzle-orm/pglite";
    const { PGlite } = (await import(/* @vite-ignore */ pgliteModule)) as typeof import("@electric-sql/pglite");
    const { drizzle } = (await import(/* @vite-ignore */ drizzlePgliteModule)) as typeof import("drizzle-orm/pglite");
    const client = dir === "memory" || dir === "" ? new PGlite() : new PGlite(dir);
    await client.waitReady;
    const db = drizzle(client, { schema }) as unknown as Db;
    return { db, kind: "pglite", close: () => client.close() };
  }
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
  const db = drizzlePostgres(sql, { schema }) as unknown as Db;
  return { db, kind: "postgres", close: () => sql.end({ timeout: 5 }) };
}

// Cached on globalThis: the Netlify dev emulator re-evaluates function bundles, and PGlite must not be
// opened twice on the same directory within one process.
const globalCache = globalThis as typeof globalThis & { __landFinderDb?: Promise<DbHandle> };

/** Lazily opened, process-wide handle for serverless functions. */
export function getDb(): Promise<DbHandle> {
  globalCache.__landFinderDb ??= createDb().catch((err: unknown) => {
    globalCache.__landFinderDb = undefined;
    throw err;
  });
  return globalCache.__landFinderDb;
}
