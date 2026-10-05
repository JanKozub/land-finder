import type { Source } from "../../shared/constants";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

/** The source is blocking us (403/429); the job should pause until `blockedUntil`. */
export class SourceBlockedError extends Error {
  constructor(
    public readonly source: Source,
    public readonly blockedUntil: Date,
  ) {
    super(`${source} blocked until ${blockedUntil.toISOString()}`);
    this.name = "SourceBlockedError";
  }
}

/** Rate window exhausted; retry after `retryAt`. */
export class RateLimitedError extends Error {
  constructor(
    public readonly source: Source,
    public readonly retryAt: Date,
  ) {
    super(`${source} rate window exhausted until ${retryAt.toISOString()}`);
    this.name = "RateLimitedError";
  }
}

/** Not enough time budget left in this invocation to make another request. */
export class BudgetExceededError extends Error {
  constructor() {
    super("time budget exceeded");
    this.name = "BudgetExceededError";
  }
}

/** The portal answered something transient (e.g. a different result set); pause the job and ask again at `retryAt`. */
export class RetryLaterError extends Error {
  constructor(
    public readonly source: Source,
    public readonly retryAt: Date,
    message: string,
    /** Merged into the job cursor when pausing (e.g. a retry counter). */
    public readonly cursorPatch: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RetryLaterError";
  }
}
