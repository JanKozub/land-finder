import { env } from "./env";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(ctx: Record<string, unknown>): Logger;
}

export function createLogger(ctx: Record<string, unknown> = {}, level: Level = env.logLevel): Logger {
  const emit = (lvl: Level, msg: string, data?: Record<string, unknown>) => {
    if (LEVELS[lvl] < LEVELS[level]) return;
    const line = JSON.stringify({ t: new Date().toISOString(), lvl, msg, ...ctx, ...data });
    if (lvl === "error") console.error(line);
    else if (lvl === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m, d) => emit("debug", m, d),
    info: (m, d) => emit("info", m, d),
    warn: (m, d) => emit("warn", m, d),
    error: (m, d) => emit("error", m, d),
    child: (more) => createLogger({ ...ctx, ...more }, level),
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
};
