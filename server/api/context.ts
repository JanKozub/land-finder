import type { Source } from "../../shared/constants";
import type { Db } from "../db/client";
import type { FetchClient } from "../http/fetch-client";
import type { Logger } from "../logger";
import type { Notifier } from "../notify/types";

export interface RouteContext {
  db: Db;
  dbKind: string;
  log: Logger;
  now: () => Date;
  fetchClient: FetchClient;
  /** Client used for OLX requests (browser-like by default); injectable for tests. */
  olxFetchClient: FetchClient;
  notifiers: Notifier[];
  /** Waits between rate-limited requests made inside a request handler; tests inject a no-op. */
  sleep: (ms: number) => Promise<void>;
  stepBudgetMs: number;
  workerSources: Source[] | null;
  appBaseUrl: string;
}
