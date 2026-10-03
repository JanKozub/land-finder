import type { Hono } from "hono";
import { getDb } from "../db/client";
import { createApp } from "./app";

// Module-level cache: Vite re-evaluates this module when server code changes, so routes stay fresh,
// while the database handle itself lives on globalThis (see db/client.ts).
let app: Hono | undefined;

/** Entry used by the Vite dev middleware (production uses netlify/functions/api.mts). */
export async function handle(req: Request): Promise<Response> {
  const handle = await getDb();
  app ??= createApp({ db: handle.db, dbKind: handle.kind });
  return app.fetch(req);
}
