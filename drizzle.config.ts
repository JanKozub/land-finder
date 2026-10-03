import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL ?? "";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  ...(url.startsWith("pglite:")
    ? { driver: "pglite", dbCredentials: { url: url.replace(/^pglite:\/\//, "") } }
    : { dbCredentials: { url } }),
});
