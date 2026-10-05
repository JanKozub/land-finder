import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kind, Source } from "../../shared/constants";
import { DEFAULT_SETTINGS } from "../../shared/schemas";
import { createTestDb } from "../../tests/helpers/pglite-db";
import { makeListing } from "../../tests/helpers/factories";
import type { DbHandle } from "../db/client";
import { acquireLeaseQuery, cancelOpenJobs, getRun, jobCounts, listJobs } from "../db/queries/jobs";
import { saveSettings } from "../db/queries/settings";
import { listings, properties, scrapeJobs } from "../db/schema";
import { RetryLaterError } from "../http/errors";
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
    expect(started.jobs.every((j) => j.suppressNotifications)).toBe(true); // empty database = initial fill

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
    expect(second.jobs.every((j) => !j.suppressNotifications)).toBe(true); // regular run announces new offers
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

  it("retries a failed page from the failing cursor, not from the start", async () => {
    const { db } = handle;
    await cancelOpenJobs(db, now());
    const settings = await saveSettings(db, { ...DEFAULT_SETTINGS, kinds: ["plot"] });
    const fetches: string[] = [];
    const inner = fakeAdapter("olx", { plot: [[plot("A", 1)], [plot("B", 2)], [plot("C", 3)]], house: [[]] }, fetches);
    let failOnce = true;
    const flaky: SourceAdapter = {
      ...inner,
      async fetchListPage(cursor, ctx) {
        if (cursor.page === 1 && failOnce) {
          failOnce = false;
          fetches.push("olx/plot/1!");
          throw new Error("Otodom redirected page 1 (different result set)");
        }
        return inner.fetchListPage(cursor, ctx);
      },
    };
    const adapters = { olx: flaky, otodom: fakeAdapter("otodom", { plot: [[]], house: [[]] }, fetches) };
    const started = await startRun(db, { mode: "backfill", trigger: "cli", settings, now: now(), adapters });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const first = await runWorker({ db, budgetMs: 60_000, holder: "f1", now, sleep: async () => {}, log: silentLogger, adapters, notifiers: [], sources: ["olx", "otodom"] });
    expect(first.failed).toBe(0); // first attempt is a retry, not a final failure
    const job = (await listJobs(db, started.run.id)).find((j) => j.source === "olx" && j.kind === "plot")!;
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(1);
    expect(job.lastError).toMatch(/different result set/);
    expect(job.cursor).toMatchObject({ page: 1 });

    clock.t += 2 * 60_000; // past the 1-minute backoff
    await runWorker({ db, budgetMs: 60_000, holder: "f2", now, sleep: async () => {}, log: silentLogger, adapters, notifiers: [], sources: ["olx", "otodom"] });
    expect((await getRun(db, started.run.id))!.status).toBe("done");
    expect(fetches.filter((f) => f.startsWith("olx/plot"))).toEqual(["olx/plot/0", "olx/plot/1!", "olx/plot/1", "olx/plot/2"]);
    expect(await db.select().from(listings).then((rows) => rows.filter((r) => r.source === "olx" && ["A", "B", "C"].includes(r.sourceId)).length)).toBe(3);
  });

  it("lets a source-limited request join the active run of the same mode", async () => {
    const { db } = handle;
    await cancelOpenJobs(db, now());
    const settings = await saveSettings(db, { ...DEFAULT_SETTINGS, kinds: ["plot"] });
    const fetches: string[] = [];
    const adapters = { olx: fakeAdapter("olx", { plot: [[plot("J1", 1)]], house: [[]] }, fetches), otodom: fakeAdapter("otodom", { plot: [[plot("J2", 2, "otodom")]], house: [[]] }, fetches) };
    const first = await startRun(db, { mode: "backfill", trigger: "cli", sources: ["olx"], settings, now: now(), adapters });
    expect(first.ok && !first.joined).toBe(true);
    if (!first.ok) return;
    const sameSource = await startRun(db, { mode: "backfill", trigger: "cli", sources: ["olx"], settings, now: now(), adapters });
    expect(sameSource.ok).toBe(false); // olx still has an open job
    const otherMode = await startRun(db, { mode: "incremental", trigger: "cli", sources: ["otodom"], settings, now: now(), adapters });
    expect(otherMode.ok).toBe(false);
    const joined = await startRun(db, { mode: "backfill", trigger: "cli", sources: ["otodom"], settings, now: now(), adapters });
    expect(joined.ok && joined.joined && joined.run.id === first.run.id).toBe(true);
    expect((await jobCounts(db, first.run.id)).queued).toBe(2);
    await runWorker({ db, budgetMs: 60_000, holder: "j1", now, sleep: async () => {}, log: silentLogger, adapters, notifiers: [], sources: ["olx", "otodom"] });
    expect((await getRun(db, first.run.id))!.status).toBe("done");
    expect(fetches.sort()).toEqual(["olx/plot/0", "otodom/plot/0"]);
  });

  it("picks up jobs a killed worker left in the running state", async () => {
    const { db } = handle;
    await cancelOpenJobs(db, now());
    const settings = await saveSettings(db, { ...DEFAULT_SETTINGS, kinds: ["plot"] });
    const fetches: string[] = [];
    const adapters = { olx: fakeAdapter("olx", { plot: [[plot("R", 1)]], house: [[]] }, fetches), otodom: fakeAdapter("otodom", { plot: [[]], house: [[]] }, fetches) };
    const started = await startRun(db, { mode: "backfill", trigger: "cli", settings, now: now(), adapters });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // Simulate a worker that claimed everything and died mid-slice (its lease has expired).
    await db.update(scrapeJobs).set({ status: "running", attempts: 1 }).where(eq(scrapeJobs.runId, started.run.id));
    expect((await jobCounts(db, started.run.id)).queued).toBe(0);

    await runWorker({ db, budgetMs: 60_000, holder: "k1", now, sleep: async () => {}, log: silentLogger, adapters, notifiers: [], sources: ["olx", "otodom"] });
    expect((await getRun(db, started.run.id))!.status).toBe("done");
    const jobs = await listJobs(db, started.run.id);
    expect(jobs.every((j) => j.status === "done")).toBe(true);
    expect(jobs.every((j) => j.attempts === 1)).toBe(true); // the interrupted claim was not counted
  });

  it("keeps the enrich job open until the list jobs of its source are finished", async () => {
    const { db } = handle;
    await cancelOpenJobs(db, now());
    const settings = await saveSettings(db, { ...DEFAULT_SETTINGS, kinds: ["plot"] });
    const calls: string[] = [];
    let pausedOnce = false;
    const otodom: SourceAdapter = {
      id: "otodom",
      label: "otodom",
      rate: { minIntervalMs: 0, maxPer10Min: 10_000, maxPerSlice: 10_000 },
      estimatedPageCostMs: 1,
      estimatedEnrichCostMs: 1,
      initialCursor: (kind, mode) => ({ kind, mode, page: 1 }),
      async fetchListPage(cursor) {
        calls.push(`list p${cursor.page}`);
        if (!pausedOnce) {
          pausedOnce = true;
          throw new RetryLaterError("otodom", new Date(clock.t + 30_000), "different result set");
        }
        const item = makeListing({ source: "otodom", sourceId: "WAIT1", lat: null, lon: null, locationPrecision: "unknown", locationRadiusKm: null });
        return { items: [item], total: 1, totalPages: 1, hasMore: false, parseErrors: 0 };
      },
      nextCursor: () => null,
      async enrich(listing) {
        calls.push(`enrich ${listing.sourceId}`);
        return { status: "ok", patch: { lat: 49.99, lon: 20.06, locationPrecision: "exact", locationRadiusKm: 0 } };
      },
    };
    const adapters = { otodom };
    const started = await startRun(db, { mode: "incremental", trigger: "manual", settings, now: now(), adapters });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // Slice 1: the list job pauses for 30 s, so the worker takes the enrich job, which has nothing yet. It must wait, not finish.
    await runWorker({ db, budgetMs: 60_000, holder: "e1", now, sleep: async () => {}, log: silentLogger, adapters, notifiers: [], sources: ["otodom"] });
    const afterFirst = await listJobs(db, started.run.id);
    const enrichJob = afterFirst.find((j) => j.type === "enrich")!;
    expect(enrichJob.status).toBe("queued");
    expect(enrichJob.notBefore.getTime()).toBe(clock.t + 30_000);
    expect(enrichJob.lastError).toMatch(/waiting for the list jobs/);
    expect((await getRun(db, started.run.id))!.status).toBe("running");

    // Slice 2 (after the pause): the list job inserts a coordinate-less listing, then the enrich job places it.
    clock.t += 31_000;
    await runWorker({ db, budgetMs: 60_000, holder: "e2", now, sleep: async () => {}, log: silentLogger, adapters, notifiers: [], sources: ["otodom"] });
    expect((await getRun(db, started.run.id))!.status).toBe("done");
    expect(calls).toEqual(["list p1", "list p1", "enrich WAIT1"]);
    const [row] = await db.select().from(listings).where(eq(listings.sourceId, "WAIT1"));
    expect(row!.lat).toBe(49.99);
    expect(row!.propertyId).not.toBeNull();
  });

  it("binds lease timestamps through columns (postgres.js would reject raw Date params)", async () => {
    const q = acquireLeaseQuery(handle.db, "t", 1000, new Date("2026-10-04T07:00:00Z")).toSQL();
    expect(q.params.some((p) => p instanceof Date)).toBe(false);
    expect(q.sql).toContain("on conflict");
    expect(await acquireLeaseQuery(handle.db, "t", 1000, new Date("2026-10-04T07:00:00Z"))).toHaveLength(1);
  });
});
