import type { Config, Context } from "@netlify/functions";
import type { Hono } from "hono";
import { createApp } from "../../server/api/app";
import { getDb } from "../../server/db/client";

let app: Hono | undefined;

export default async (req: Request, _context: Context): Promise<Response> => {
  const handle = await getDb();
  app ??= createApp({ db: handle.db, dbKind: handle.kind });
  return app.fetch(req);
};

export const config: Config = {
  path: ["/api", "/api/*"],
};
