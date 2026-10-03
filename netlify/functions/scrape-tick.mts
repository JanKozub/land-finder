import type { Config } from "@netlify/functions";
import { getDb } from "../../server/db/client";
import { env } from "../../server/env";
import { runScheduledTick } from "../../server/jobs/tick";

// Runs on the cron schedule from netlify.toml; the body is ignored by Netlify but useful for `functions:invoke`.
export default async (_req: Request): Promise<Response> => {
  const handle = await getDb();
  const result = await runScheduledTick({ db: handle.db, budgetMs: env.tickBudgetMs });
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
};

export const config: Config = {
  schedule: "*/30 * * * *",
};
