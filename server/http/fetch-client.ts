import { env } from "../env";
import { HttpError } from "./errors";

export interface RawResponse {
  status: number;
  headers: Headers;
  text: string;
}

export interface FetchClientOptions {
  userAgent?: string;
  proxyUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface FetchClient {
  get(url: string, headers?: Record<string, string>): Promise<RawResponse>;
}

/** Plain HTTP GET with a browser-like User-Agent, timeout and optional proxy. No retries here. */
export function createFetchClient(opts: FetchClientOptions = {}): FetchClient {
  const userAgent = opts.userAgent ?? env.userAgent;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let fetchImpl: typeof fetch = opts.fetchImpl ?? fetch;
  let dispatcherPromise: Promise<unknown> | undefined;

  if (opts.proxyUrl) {
    dispatcherPromise = import("undici").then((u) => {
      fetchImpl = u.fetch as unknown as typeof fetch;
      return new u.ProxyAgent(opts.proxyUrl!);
    });
  }

  return {
    async get(url, headers = {}) {
      const dispatcher = dispatcherPromise ? await dispatcherPromise : undefined;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const init: RequestInit & { dispatcher?: unknown } = {
          method: "GET",
          headers: { "User-Agent": userAgent, ...headers },
          signal: controller.signal,
          redirect: "follow",
        };
        if (dispatcher) init.dispatcher = dispatcher;
        const res = await fetchImpl(url, init as RequestInit);
        const text = await res.text();
        return { status: res.status, headers: res.headers, text };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") throw new HttpError(0, url, `timeout after ${timeoutMs} ms`);
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Browser-like client (Chrome TLS ciphers, HTTP/2 and header set via got-scraping). OLX's CloudFront
 * rules reject plain Node fetch from IPs they have flagged, while this fingerprint keeps passing.
 */
export function createBrowserLikeClient(opts: FetchClientOptions = {}): FetchClient {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let gotPromise: Promise<typeof import("got-scraping")> | undefined;
  return {
    async get(url, headers = {}) {
      gotPromise ??= import("got-scraping");
      const { gotScraping } = await gotPromise;
      try {
        const res = await gotScraping({
          url,
          headers,
          responseType: "text",
          throwHttpErrors: false,
          timeout: { request: timeoutMs },
          retry: { limit: 0 },
          proxyUrl: opts.proxyUrl || undefined,
          headerGeneratorOptions: {
            browsers: [{ name: "chrome", minVersion: 120 }],
            devices: ["desktop"],
            operatingSystems: ["macos", "windows"],
            locales: ["pl-PL", "pl"],
          },
        });
        const out = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") out.set(k, v);
          else if (Array.isArray(v)) out.set(k, v.join(", "));
        }
        return { status: res.statusCode, headers: out, text: String(res.body) };
      } catch (err) {
        if (err instanceof Error && /timeout/i.test(err.name + err.message)) throw new HttpError(0, url, `timeout after ${timeoutMs} ms`);
        throw err;
      }
    },
  };
}
