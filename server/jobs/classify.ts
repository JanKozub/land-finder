import type { RunStats } from "../../shared/schemas";
import { BudgetExceededError, HttpError, RateLimitedError, SourceBlockedError } from "../http/errors";
import type { HandlerResult } from "./types";

/** Maps an error thrown while fetching into a pause (transient) or a failure (retried with backoff). */
export function classifyError(err: unknown, cursor: Record<string, unknown> | null, stats: RunStats, now: Date): HandlerResult {
  if (err instanceof SourceBlockedError) {
    return { status: "paused", cursor, notBefore: err.blockedUntil, stats, error: err.message };
  }
  if (err instanceof RateLimitedError) {
    return { status: "paused", cursor, notBefore: err.retryAt, stats, error: err.message };
  }
  if (err instanceof BudgetExceededError) {
    return { status: "paused", cursor, notBefore: now, stats };
  }
  const message = err instanceof HttpError ? err.message : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return { status: "failed", cursor, stats, error: message };
}
