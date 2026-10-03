import type { Source } from "../../shared/constants";
import { olxAdapter } from "./olx/adapter";
import { otodomAdapter } from "./otodom/adapter";
import type { SourceAdapter } from "./types";

export const adapters: Record<Source, SourceAdapter> = {
  olx: olxAdapter,
  otodom: otodomAdapter,
};

export function adapterFor(source: Source): SourceAdapter {
  const a = adapters[source];
  if (!a) throw new Error(`unknown source ${source}`);
  return a;
}
