import type { RunStats } from "../../shared/schemas";
import { BudgetExceededError, HttpError, RateLimitedError, RetryLaterError, SourceBlockedError } from "../http/errors";
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
  if (err instanceof RetryLaterError) {
    return { status: "paused", cursor: { ...(cursor ?? {}), ...err.cursorPatch }, notBefore: err.retryAt, stats, error: err.message };
  }
  const base = err instanceof HttpError ? err.message : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? ` — ${err.cause.message}` : "";
  return { status: "failed", cursor, stats, error: `${base}${cause}` };
}
