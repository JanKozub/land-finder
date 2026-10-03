import { env } from "../server/env";
import { createDb } from "../server/db/client";
import { ensureSettings } from "../server/db/queries/settings";

async function main() {
  const url = env.databaseUrlMigrations;
  const handle = await createDb(url);
  console.log(`Applying migrations (${handle.kind}) …`);
  if (handle.kind === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(handle.db as any, { migrationsFolder: "drizzle" });
  } else {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(handle.db as any, { migrationsFolder: "drizzle" });
  }
  await ensureSettings(handle.db);
  await handle.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
