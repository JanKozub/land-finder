# Land Finder — conventions

- Code, identifiers and comments in **English**; all UI copy in **Polish** (`src/i18n/pl.ts` + inline strings).
- Layers: `shared/` (zod schemas, constants shared by client and server) · `server/` (Node only: db, sources,
  dedup, jobs, notify, api) · `netlify/functions/` (thin entrypoints) · `src/` (Vite React SPA) · `scripts/` (CLI).
- Database: Drizzle schema in `server/db/schema.ts`; after changing it run `pnpm db:generate` and commit the SQL in
  `drizzle/`. Never edit generated migrations by hand. Local dev DB is PGlite (`pglite://.data/dev`), production is
  Supabase via the transaction pooler (`prepare: false`).
- Scraping must stay polite: OLX only `User-Agent` + `Accept` headers, ≥2 s between requests, ≤20 per 10 min; never
  add `Origin`/`sec-ch-ua` headers (triggers 403). Every parsed listing must carry an absolute `url`.
- Worker invocations must finish within `SCRAPE_STEP_BUDGET_MS` (default 8 s): any new job type needs a cursor and
  must return `paused` when `remainingMs()` is low.
- Tests: vitest; parsers use fixtures in `tests/fixtures`; DB/API tests use PGlite in memory (`tests/helpers/pglite-db.ts`).
  Run `pnpm typecheck && pnpm test` before finishing a change.
- Deploys: production deploys cost Netlify credits — prefer deploy previews; never enable auto-merge or deploy
  without being asked.
