import { existsSync } from "node:fs";
import { deriveMigrationsUrl } from "./db/urls";

// Load .env for local CLI/dev runs. Netlify injects env vars itself; vitest sets its own.
if (!process.env.NETLIFY && !process.env.VITEST && existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // ignore unreadable .env
  }
}

const int = (v: string | undefined, fallback: number): number => {
  const n = v === undefined ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};
const csv = (v: string | undefined): string[] | null =>
  v && v.trim() ? v.split(",").map((s) => s.trim()).filter(Boolean) : null;

export const env = {
  databaseUrl: process.env.DATABASE_URL || "pglite://.data/dev",
  databaseUrlMigrations: process.env.DATABASE_URL_MIGRATIONS || deriveMigrationsUrl(process.env.DATABASE_URL || "") || "pglite://.data/dev",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  appBaseUrl: (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, ""),
  userAgent:
    process.env.SCRAPE_USER_AGENT ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  stepBudgetMs: int(process.env.SCRAPE_STEP_BUDGET_MS, 8000),
  /** Scheduled functions share the synchronous function limit (10 s on Free), so the tick defaults to the step budget. */
  tickBudgetMs: int(process.env.SCRAPE_TICK_BUDGET_MS, int(process.env.SCRAPE_STEP_BUDGET_MS, 8000)),
  workerSources: csv(process.env.WORKER_SOURCES),
  olxProxyUrl: process.env.OLX_PROXY_URL || "",
  /** "browser" (default) sends OLX requests with a browser-like TLS/header fingerprint; "fetch" uses plain Node fetch. */
  olxClient: (process.env.OLX_CLIENT === "fetch" ? "fetch" : "browser") as "browser" | "fetch",
  appSecret: process.env.APP_SECRET || "",
  storeRaw: process.env.STORE_RAW === "1",
  logLevel: (process.env.LOG_LEVEL || "info") as "debug" | "info" | "warn" | "error",
  isNetlify: Boolean(process.env.NETLIFY),
  /** Postgres connections per process: one inside a function, several for the CLI so parallel portal jobs do not queue behind one round trip. */
  dbPoolMax: int(process.env.DB_POOL_MAX, process.env.NETLIFY ? 1 : 6),
};
