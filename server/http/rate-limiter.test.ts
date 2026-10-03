import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../../tests/helpers/pglite-db";
import type { DbHandle } from "../db/client";
import { getSourceState } from "../db/queries/source-state";
import { silentLogger } from "../logger";
import { BudgetExceededError, SourceBlockedError } from "./errors";
import type { FetchClient } from "./fetch-client";
import { blockDurationMs, createSourceHttp } from "./rate-limiter";

let handle: DbHandle;
beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => handle.close());

describe("source http politeness", () => {
  it("retries once after 403, then blocks the source with escalating duration", async () => {
    let calls = 0;
    const client: FetchClient = { get: async () => ({ status: 403, headers: new Headers(), text: "blocked" }) };
    const t0 = Date.parse("2026-10-03T10:00:00Z");
    const http = createSourceHttp({
      db: handle.db,
      source: "olx",
      rate: { minIntervalMs: 0, maxPer10Min: 100, maxPerSlice: 10 },
      client: { get: (...a) => (calls++, client.get(...a)) },
      remainingMs: () => 60_000,
      sleep: async () => {},
      now: () => new Date(t0),
      log: silentLogger,
    });
    await expect(http.get("https://www.olx.pl/api/v1/offers/")).rejects.toBeInstanceOf(SourceBlockedError);
    expect(calls).toBe(2);
    const state = await getSourceState(handle.db, "olx");
    expect(state.consecutiveBlocks).toBe(1);
    expect(state.blockedUntil!.getTime()).toBe(t0 + blockDurationMs(1));
    await expect(http.get("https://www.olx.pl/api/v1/offers/")).rejects.toBeInstanceOf(SourceBlockedError);
    expect(calls).toBe(2);
    expect(blockDurationMs(3)).toBe(3 * 60 * 60 * 1000);
    expect(blockDurationMs(10)).toBe(6 * 60 * 60 * 1000);
  });

  it("records requests and enforces the per-slice cap", async () => {
    let t = Date.parse("2026-10-03T12:00:00Z");
    const client: FetchClient = { get: async () => ({ status: 200, headers: new Headers(), text: "{}" }) };
    const http = createSourceHttp({
      db: handle.db,
      source: "otodom",
      rate: { minIntervalMs: 400, maxPer10Min: 100, maxPerSlice: 2 },
      client,
      remainingMs: () => 60_000,
      sleep: async (ms) => {
        t += ms;
      },
      now: () => new Date(t),
      log: silentLogger,
    });
    await http.get("https://www.otodom.pl/a");
    await http.get("https://www.otodom.pl/b");
    await expect(http.get("https://www.otodom.pl/c")).rejects.toBeInstanceOf(BudgetExceededError);
    const state = await getSourceState(handle.db, "otodom");
    expect(state.requestsWindow).toHaveLength(2);
    expect(state.consecutiveBlocks).toBe(0);
    expect(state.lastSuccessAt).not.toBeNull();
  });
});
