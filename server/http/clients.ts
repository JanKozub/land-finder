import type { Source } from "../../shared/constants";
import { env } from "../env";
import { createFetchClient, type FetchClient } from "./fetch-client";

/** OLX may go through an optional proxy (OLX_PROXY_URL); everything else uses the plain client. */
export function clientForSource(source: Source, base: FetchClient, olxClient?: FetchClient): FetchClient {
  if (source !== "olx") return base;
  if (olxClient) return olxClient;
  return env.olxProxyUrl ? createFetchClient({ proxyUrl: env.olxProxyUrl }) : base;
}
