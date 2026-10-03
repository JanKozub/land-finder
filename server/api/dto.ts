import type { JobDto, RunDto, SourceStateDto } from "../../shared/schemas";
import type { ScrapeJobRow, ScrapeRunRow, SourceStateRow } from "../db/schema";

export function runToDto(run: ScrapeRunRow): RunDto {
  return {
    id: run.id,
    trigger: run.trigger,
    mode: run.mode,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    stats: run.stats,
    error: run.error,
  };
}

export function jobToDto(job: ScrapeJobRow): JobDto {
  return {
    id: job.id,
    runId: job.runId,
    type: job.type,
    source: job.source,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    notBefore: job.notBefore.toISOString(),
    lastError: job.lastError,
    cursor: job.cursor,
  };
}

export function sourceStateToDto(state: SourceStateRow, now: Date): SourceStateDto {
  const windowStart = now.getTime() - 10 * 60 * 1000;
  return {
    source: state.source,
    lastRequestAt: state.lastRequestAt?.toISOString() ?? null,
    lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
    blockedUntil: state.blockedUntil && state.blockedUntil > now ? state.blockedUntil.toISOString() : null,
    consecutiveBlocks: state.consecutiveBlocks,
    requestsLast10Min: (state.requestsWindow ?? []).filter((iso) => Date.parse(iso) > windowStart).length,
    lastError: state.lastError,
    meta: state.meta,
  };
}
