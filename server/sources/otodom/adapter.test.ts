import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../../shared/schemas";
import { loadFixture, loadFixtureText } from "../../../tests/helpers/pglite-db";
import { RetryLaterError } from "../../http/errors";
import { silentLogger } from "../../logger";
import type { SourceContext } from "../types";
import { otodomAdapter, type OtodomCursor } from "./adapter";
import { pagePropsOf } from "./parse-list";

const page = loadFixtureText("otodom/search-page.html");
const LIST_PATH = "/pl/wyniki/sprzedaz/dzialka/malopolskie/wielicki/wieliczka";
const redirectStub = (target: string) => JSON.stringify({ pageProps: { lang: "pl", __N_REDIRECT: target, __N_REDIRECT_STATUS: 308 }, __N_SSP: true });
/** The recorded fixtures are page 1; later pages differ only in `currentPage`. */
const atPage = (html: string, n: number) => html.replace(/"currentPage":\s*\d+/, `"currentPage":${n}`);

interface Fake {
  /** Body for the `_next/data` route (a list is consumed in order, the last one repeats); undefined answers 404. */
  json?: string | string[];
  html?: string | string[];
  radiusZeroHtml?: string;
  radiusKm?: number;
  meta?: Record<string, unknown>;
}

/** Answers from a list in order, repeating the last one. */
function sequence(bodies: string | string[] | undefined, fallback: string): () => string {
  const list = bodies === undefined ? [fallback] : Array.isArray(bodies) ? bodies : [bodies];
  let i = 0;
  return () => list[Math.min(i++, list.length - 1)]!;
}

function context(fake: Fake): SourceContext & { urls: string[]; metaPatches: Record<string, unknown>[] } {
  const urls: string[] = [];
  const metaPatches: Record<string, unknown>[] = [];
  const nextJson = sequence(fake.json, "");
  const nextHtml = sequence(fake.html, page);
  return {
    urls,
    metaPatches,
    http: {
      get: async (url) => {
        urls.push(url);
        if (url.includes("/_next/data/")) {
          if (fake.json === undefined) return { status: 404, headers: new Headers(), text: "" };
          return { status: 200, headers: new Headers({ "content-type": "application/json" }), text: nextJson() };
        }
        const text = url.includes("distanceRadius=0") ? (fake.radiusZeroHtml ?? page.replace(/"totalItems":\s*\d+/, '"totalItems":159')) : nextHtml();
        return { status: 200, headers: new Headers({ "content-type": "text/html" }), text };
      },
      requestsThisSlice: 0,
    },
    settings: { ...DEFAULT_SETTINGS, otodom: { ...DEFAULT_SETTINGS.otodom, radiusKm: fake.radiusKm ?? 15 } },
    meta: fake.meta ?? {},
    setMeta: async (patch) => {
      metaPatches.push(patch);
    },
    log: silentLogger,
    now: () => new Date(),
  };
}

const cursorAt = (pageNo: number, totalPages: number | null, total: number | null = totalPages === null ? null : totalPages * 72): OtodomCursor => ({ kind: "plot", mode: "backfill", page: pageNo, totalPages, total });
const route = (url: string) => (url.includes("/_next/data/") ? "json" : url.includes("distanceRadius=0") ? "probe" : "html");

describe("Otodom adapter radius guard", () => {
  it("pauses the job when the portal keeps answering with the no-radius result set", async () => {
    const ctx = context({ radiusZeroHtml: page }); // radius 0 returns the very same totals
    const cursor = otodomAdapter.initialCursor("plot", "incremental", ctx.settings);
    const err = await otodomAdapter.fetchListPage(cursor, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RetryLaterError);
    expect((err as RetryLaterError).message).toMatch(/location alone/);
    expect((err as RetryLaterError).cursorPatch).toEqual({ retries: 1 });
    expect((err as RetryLaterError).retryAt.getTime() - ctx.now().getTime()).toBeGreaterThan(29_000);
    expect(ctx.urls.map(route)).toEqual(["html", "probe", "html", "probe"]);
  });

  it("asks the first page again when the no-radius answer was a one-off", async () => {
    const wrong = page.replace(/"totalItems":\s*\d+/, '"totalItems":159');
    const ctx = context({ html: [wrong, page] });
    const cursor = otodomAdapter.initialCursor("plot", "incremental", ctx.settings);
    const result = await otodomAdapter.fetchListPage(cursor, ctx);
    expect(result.total).toBeGreaterThan(159);
    expect(ctx.urls.map(route)).toEqual(["html", "probe", "html", "probe"]);
  });

  it("accepts the page when the radius-0 count differs", async () => {
    const ctx = context({});
    const cursor = otodomAdapter.initialCursor("plot", "incremental", ctx.settings);
    const result = await otodomAdapter.fetchListPage(cursor, ctx);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(159);
  });

  it("snaps the configured radius up to a value the portal supports", async () => {
    const ctx = context({ radiusKm: 19, html: atPage(page, 2) });
    await otodomAdapter.fetchListPage(cursorAt(2, 16), ctx);
    expect(ctx.urls).toHaveLength(1);
    expect(ctx.urls[0]).toContain("distanceRadius=25");
    expect(otodomAdapter.probe!(ctx.settings).url).toContain("distanceRadius=25");
  });
});

describe("Otodom adapter list routes", () => {
  it("reads the json route when the buildId is known and remembers a new buildId from html", async () => {
    const payload = JSON.stringify({ pageProps: pagePropsOf(loadFixture("otodom/search-dzialka-p1.json")), __N_SSP: true });
    const ctx = context({ json: atPage(payload, 2), meta: { buildId: "old" } });
    const result = await otodomAdapter.fetchListPage(cursorAt(2, 24), ctx);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.hasMore).toBe(true);
    expect(ctx.urls).toHaveLength(1);
    expect(ctx.urls[0]).toContain("/_next/data/old/");

    const html = context({ meta: { buildId: "stale" }, html: atPage(page, 2) }); // 404 on the data route → html
    const viaHtml = await otodomAdapter.fetchListPage(cursorAt(2, 24), html);
    expect(viaHtml.items.length).toBeGreaterThan(0);
    expect(html.metaPatches).toContainEqual({ buildId: "mGqk5wgHgzkZ129f54Sjh" });
  });

  it("falls back to html when the json payload is not a search result", async () => {
    const ctx = context({ json: JSON.stringify({ pageProps: { statusCode: 500 } }), meta: { buildId: "b1" }, html: atPage(page, 2) });
    const result = await otodomAdapter.fetchListPage(cursorAt(2, 24), ctx);
    expect(result.items.length).toBeGreaterThan(0);
    expect(ctx.urls.map((u) => (u.includes("/_next/data/") ? "json" : "html"))).toEqual(["json", "html"]);
  });

  it("treats a redirect to the last page as the end of the list", async () => {
    const ctx = context({ json: redirectStub(`${LIST_PATH}?page=15`), meta: { buildId: "b1" } });
    const result = await otodomAdapter.fetchListPage(cursorAt(17, 16), ctx);
    expect(result).toMatchObject({ items: [], hasMore: false });
    expect(ctx.urls).toHaveLength(1);
  });

  it("re-asks a page that landed far below the announced page count on the other route, then pauses, then gives up", async () => {
    const landed = atPage(page, 3).replace(/"totalPages":\s*\d+/, '"totalPages":5');
    const ctx = context({ json: redirectStub(`${LIST_PATH}?page=3`), html: landed, meta: { buildId: "b1" } });
    const err = await otodomAdapter.fetchListPage({ ...cursorAt(6, 16), retries: 2 }, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RetryLaterError);
    expect((err as RetryLaterError).cursorPatch).toEqual({ retries: 3 });
    expect(ctx.urls.map(route)).toEqual(["json", "html"]);

    const exhausted = context({ json: redirectStub(`${LIST_PATH}?page=3`), html: landed, meta: { buildId: "b1" } });
    await expect(otodomAdapter.fetchListPage({ ...cursorAt(6, 16), retries: 8 }, exhausted)).rejects.toThrow(/giving up/);
  });

  it("clears the pause counter once the page came through", () => {
    const next = otodomAdapter.nextCursor({ ...cursorAt(6, 16), retries: 3 }, { items: [{} as never], total: 1104, totalPages: 16, hasMore: true, parseErrors: 0 }, { newCount: 1 });
    expect(next).toMatchObject({ page: 7, retries: 0 });
  });

  it("recovers when the next answer is the real page", async () => {
    const ctx = context({ json: redirectStub(`${LIST_PATH}?page=3`), html: atPage(page, 6), meta: { buildId: "b1" } });
    const result = await otodomAdapter.fetchListPage(cursorAt(6, 16), ctx);
    expect(result.items.length).toBeGreaterThan(0);
    expect(ctx.urls.map(route)).toEqual(["json", "html"]);
  });

  it("re-asks a page whose total is far below the one announced on page 1, even when the page number matches", async () => {
    const shrunk = atPage(page, 2).replace(/"totalItems":\s*\d+/, '"totalItems":159').replace(/"totalPages":\s*\d+/, '"totalPages":3');
    const ctx = context({ html: [shrunk, atPage(page, 2)] });
    const result = await otodomAdapter.fetchListPage(cursorAt(2, 24, 1663), ctx);
    expect(result.total).toBe(1663);
    expect(ctx.urls.map(route)).toEqual(["html", "html"]);
  });

  it("carries the announced figures in the cursor", () => {
    const next = otodomAdapter.nextCursor(cursorAt(1, null, null), { items: [{} as never], total: 1663, totalPages: 24, hasMore: true, parseErrors: 0 }, { newCount: 1 });
    expect(next).toMatchObject({ page: 2, totalPages: 24, total: 1663 });
  });

  it("falls back to html when the json route redirects to a page that is not before the requested one", async () => {
    const ctx = context({ json: redirectStub(`${LIST_PATH}?page=2`), meta: { buildId: "b1" }, html: atPage(page, 2) });
    const result = await otodomAdapter.fetchListPage(cursorAt(2, 24), ctx);
    expect(result.items.length).toBeGreaterThan(0);
    expect(ctx.urls).toHaveLength(2);
  });
});
