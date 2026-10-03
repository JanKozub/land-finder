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
  notifiers: Notifier[];
  stepBudgetMs: number;
  workerSources: Source[] | null;
  appBaseUrl: string;
}
