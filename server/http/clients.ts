import type { Source } from "../../shared/constants";
import { env } from "../env";
import { createBrowserLikeClient, createFetchClient, type FetchClient } from "./fetch-client";

let defaultOlxClient: FetchClient | undefined;

/**
 * OLX gets a browser-like client (optionally through OLX_PROXY_URL); every other portal uses the plain client.
 * An explicitly injected `olxClient` (tests, custom setups) always wins.
 */
export function clientForSource(source: Source, base: FetchClient, olxClient?: FetchClient): FetchClient {
  if (source !== "olx") return base;
  if (olxClient) return olxClient;
  if (env.olxClient === "fetch") return env.olxProxyUrl ? createFetchClient({ proxyUrl: env.olxProxyUrl }) : base;
  defaultOlxClient ??= createBrowserLikeClient({ proxyUrl: env.olxProxyUrl });
  return defaultOlxClient;
}
