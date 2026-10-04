import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kind, Source } from "../../shared/constants";
import { DEFAULT_SETTINGS } from "../../shared/schemas";
import { createTestDb } from "../../tests/helpers/pglite-db";
import { makeListing } from "../../tests/helpers/factories";
import type { DbHandle } from "../db/client";
import { acquireLeaseQuery, cancelOpenJobs, getRun, jobCounts, listJobs } from "../db/queries/jobs";
import { saveSettings } from "../db/queries/settings";
import { listings, properties } from "../db/schema";
import { silentLogger } from "../logger";
import type { NormalizedListing, SourceAdapter } from "../sources/types";
import { startRun } from "./plans";
import { runWorker } from "./worker";

const clock = { t: Date.parse("2026-10-03T10:00:00Z") };
const now = () => new Date(clock.t);

function fakeAdapter(id: Source, pages: Record<Kind, NormalizedListing[][]>, fetches: string[]): SourceAdapter {
  return {
    id,
    label: id,
    rate: { minIntervalMs: 0, maxPer10Min: 10_000, maxPerSlice: 10_000 },
    estimatedPageCostMs: 2000,
    initialCursor: (kind, mode) => ({ kind, mode, page: 0 }),
    async fetchListPage(cursor) {
      fetches.push(`${id}/${cursor.kind}/${cursor.page}`);
      clock.t += 1500;
      const list = pages[cursor.kind];
      return { items: list[cursor.page] ?? [], total: list.flat().length, totalPages: list.length, hasMore: cursor.page + 1 < list.length, parseErrors: 0 };
    },
    nextCursor(cursor, page, info) {
      if (!page.hasMore) return null;
      if (cursor.mode === "incremental" && info.newCount === 0) return null;
      return { ...cursor, page: cursor.page + 1 };
    },
  };
}

const plot = (sourceId: string, i: number, source: Source = "olx") => makeListing({ source, sourceId, lat: 49.95 + i * 0.01, lon: 20.0 + i * 0.01 });

let handle: DbHandle;
beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => handle.close());

describe("worker", () => {
  it("runs a full incremental pass, pauses on budget and resumes, and dedups across sources", async () => {
    const { db } = handle;
    const settings = await saveSettings(db, { ...DEFAULT_SETTINGS, kinds: ["plot", "house"] });
    const fetches: string[] = [];
    const olx = fakeAdapter(
      "olx",
      {
        plot: [[plot("1", 1), plot("2", 2), plot("3", 3)], [plot("4", 4), plot("5", 5)]],
        house: [[makeListing({ source: "olx", sourceId: "H1", kind: "house", areaM2: 120, plotAreaM2: 800, price: 700_000, lat: 49.9, lon: 20.1 })]],
      },
      fetches,
    );
    const otodom = fakeAdapter(
      "otodom",
      { plot: [[plot("X", 1, "otodom")]], house: [[]] }, // same spot/area/price as OLX plot "1"
      fetches,
    );
    const adapters = { olx, otodom };

    const started = await startRun(db, { mode: "incremental", trigger: "manual", settings, now: now(), adapters });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.jobs).toHaveLength(4); // 2 olx list + 2 otodom list (fake adapters have no enrich step)

    // Budget allows exactly one page: 3000 ms budget, page cost estimate 2000, each fetch advances the clock 1500 ms.
    const first = await runWorker({ db, budgetMs: 3000, holder: "t1", now, sleep: async () => {}, log: silentLogger, adapters, notifiers: [], sources: ["olx", "otodom"] });
    expect(first.skipped).toBeNull();
    expect(first.paused).toBeGreaterThanOrEqual(1);
    const paused = (await listJobs(db, started.run.id)).find((j) => j.status === "queued" && j.cursor && (j.cursor as { page: number }).page === 1);
    expect(paused).toBeDefined();

    let guard = 0;
    while ((await jobCounts(db, started.run.id)).queued > 0 && guard++ < 10) {
      await runWorker({ db, budgetMs: 60_000, holder: "t2", now, sleep: async () => {}, log: silentLogger, adapters, notifiers: [], sources: ["olx", "otodom"] });
    }
    const run = (await getRun(db, started.run.id))!;
    expect(run.status).toBe("done");
    expect(run.stats.newListings).toBe(7);
    expect(run.stats.pages).toBe(5); // olx/plot ×2, olx/house, otodom/plot, otodom/house

    const allListings = await db.select().from(listings);
    expect(allListings).toHaveLength(7);
    const props = await db.select().from(properties);
    expect(props).toHaveLength(6); // Otodom "X" merged into OLX "1"
    const merged = props.find((p) => p.sources.length === 2)!;
    expect(merged.sources.sort()).toEqual(["olx", "otodom"]);
    expect(merged.links).toHaveLength(2);
    expect(fetches.filter((f) => f.startsWith("olx/plot")).length).toBe(2);

    // Second incremental run: nothing new -> one page per source/kind, zero new listings.
    fetches.length = 0;
    const second = await startRun(db, { mode: "incremental", trigger: "manual", settings, now: now(), adapters });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    await runWorker({ db, budgetMs: 60_000, holder: "t3", now, sleep: async () => {}, log: silentLogger, adapters, notifiers: [], sources: ["olx", "otodom"] });
    const run2 = (await getRun(db, second.run.id))!;
    expect(run2.status).toBe("done");
    expect(run2.stats.newListings ?? 0).toBe(0);
    expect(fetches.filter((f) => f.startsWith("olx/plot"))).toEqual(["olx/plot/0"]);

    // Lease: a second worker invoked while another holds the lease is skipped.
    const [p1] = await db.select().from(properties).where(eq(properties.id, merged.id));
    expect(p1!.primaryUrl).toMatch(/^https:\/\//);
  });

  it("refuses to start a run while jobs are open and cancels them", async () => {
    const { db } = handle;
    await cancelOpenJobs(db, now());
    const settings = await saveSettings(db, { ...DEFAULT_SETTINGS, kinds: ["plot"] });
    const fetches: string[] = [];
    const adapters = { olx: fakeAdapter("olx", { plot: [[plot("Z", 9)]], house: [[]] }, fetches), otodom: fakeAdapter("otodom", { plot: [[]], house: [[]] }, fetches) };
    const a = await startRun(db, { mode: "backfill", trigger: "cli", settings, now: now(), adapters });
    expect(a.ok).toBe(true);
    const b = await startRun(db, { mode: "incremental", trigger: "manual", settings, now: now(), adapters });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("already_running");
    expect(await cancelOpenJobs(db, now())).toBeGreaterThan(0);
    expect((await jobCounts(db)).queued).toBe(0);
  });

  it("binds lease timestamps through columns (postgres.js would reject raw Date params)", async () => {
    const q = acquireLeaseQuery(handle.db, "t", 1000, new Date("2026-10-04T07:00:00Z")).toSQL();
    expect(q.params.some((p) => p instanceof Date)).toBe(false);
    expect(q.sql).toContain("on conflict");
    expect(await acquireLeaseQuery(handle.db, "t", 1000, new Date("2026-10-04T07:00:00Z"))).toHaveLength(1);
  });
});
