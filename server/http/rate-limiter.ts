import type { Source } from "../../shared/constants";
import type { Db } from "../db/client";
import { getSourceState, updateSourceState } from "../db/queries/source-state";
import type { Logger } from "../logger";
import { BudgetExceededError, HttpError, RateLimitedError, SourceBlockedError } from "./errors";
import type { FetchClient, RawResponse } from "./fetch-client";

export interface RateConfig {
  minIntervalMs: number;
  maxPer10Min: number;
  maxPerSlice: number;
}

export interface SourceHttpOptions {
  db: Db;
  source: Source;
  rate: RateConfig;
  client: FetchClient;
  /** Returns ms left in this invocation. */
  remainingMs: () => number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log: Logger;
  /** Called after every request (for run statistics). */
  onRequest?: () => void;
}

export interface SourceHttp {
  get(url: string, headers?: Record<string, string>): Promise<RawResponse>;
  requestsThisSlice: number;
}

const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_BASE_MS = 45 * 60 * 1000;
const BLOCK_CAP_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_403_MS = 10_000;

export function blockDurationMs(consecutiveBlocks: number): number {
  return Math.min(BLOCK_CAP_MS, BLOCK_BASE_MS * 2 ** Math.max(0, consecutiveBlocks - 1));
}

/**
 * Wraps a FetchClient with persisted, per-source politeness rules:
 * minimum interval between requests, a 10-minute sliding window, a per-invocation cap,
 * and exponential blocking after 403/429 responses.
 */
export function createSourceHttp(opts: SourceHttpOptions): SourceHttp {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // Concurrent callers (an enrich job fetching several ad pages at once) take turns through acquire(), so the
  // minimum interval and the window are enforced across all of them; only the waiting is serialized, not the fetch.
  let gate: Promise<unknown> = Promise.resolve();
  const gated = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = gate.then(fn, fn);
    gate = next.catch(() => undefined);
    return next;
  };
  const self: SourceHttp = {
    requestsThisSlice: 0,
    async get(url, headers) {
      let retried = false;
      for (;;) {
        await gated(acquire);
        const res = await opts.client.get(url, headers);
        self.requestsThisSlice += 1;
        opts.onRequest?.();
        if (res.status === 403 || res.status === 429) {
          opts.log.warn("source responded with block status", { source: opts.source, status: res.status, url });
          if (!retried && opts.remainingMs() > RETRY_AFTER_403_MS + 2000) {
            retried = true;
            await sleep(RETRY_AFTER_403_MS);
            continue;
          }
          throw await markBlocked(res.status);
        }
        if (res.status >= 500) throw new HttpError(res.status, url);
        await updateSourceState(opts.db, opts.source, { consecutiveBlocks: 0, lastSuccessAt: now(), lastError: null });
        return res;
      }
    },
  };

  async function acquire(): Promise<void> {
    const state = await getSourceState(opts.db, opts.source);
    const t = now();
    if (state.blockedUntil && state.blockedUntil > t) throw new SourceBlockedError(opts.source, state.blockedUntil);
    if (self.requestsThisSlice >= opts.rate.maxPerSlice) throw new BudgetExceededError();
    const window = (state.requestsWindow ?? []).filter((iso) => Date.parse(iso) > t.getTime() - WINDOW_MS);
    if (window.length >= opts.rate.maxPer10Min) {
      const oldest = Math.min(...window.map((iso) => Date.parse(iso)));
      throw new RateLimitedError(opts.source, new Date(oldest + WINDOW_MS));
    }
    const last = state.lastRequestAt ? state.lastRequestAt.getTime() : 0;
    const jitter = 0.8 + Math.random() * 0.4;
    const waitMs = Math.max(0, last + opts.rate.minIntervalMs * jitter - t.getTime());
    if (waitMs + 500 > opts.remainingMs()) throw new BudgetExceededError();
    if (waitMs > 0) await sleep(waitMs);
    const at = now();
    await updateSourceState(opts.db, opts.source, {
      lastRequestAt: at,
      requestsWindow: [...window, at.toISOString()],
    });
  }

  async function markBlocked(status: number): Promise<SourceBlockedError> {
    const state = await getSourceState(opts.db, opts.source);
    const blocks = state.consecutiveBlocks + 1;
    const until = new Date(now().getTime() + blockDurationMs(blocks));
    await updateSourceState(opts.db, opts.source, {
      consecutiveBlocks: blocks,
      blockedUntil: until,
      lastError: `HTTP ${status}`,
    });
    return new SourceBlockedError(opts.source, until);
  }

  return self;
}
