import type { Source } from "../../shared/constants";
import { adresowoAdapter } from "./adresowo/adapter";
import { domiportaAdapter } from "./domiporta/adapter";
import { gratkaAdapter } from "./gratka/adapter";
import { morizonAdapter } from "./morizon/adapter";
import { nieruchomosciOnlineAdapter } from "./nieruchomosci-online/adapter";
import { olxAdapter } from "./olx/adapter";
import { otodomAdapter } from "./otodom/adapter";
import type { SourceAdapter } from "./types";

export type AdapterRegistry = Partial<Record<Source, SourceAdapter>>;

export const adapters: AdapterRegistry = {
  olx: olxAdapter,
  otodom: otodomAdapter,
  nieruchomosci_online: nieruchomosciOnlineAdapter,
  morizon: morizonAdapter,
  gratka: gratkaAdapter,
  domiporta: domiportaAdapter,
  adresowo: adresowoAdapter,
};

export function adapterFor(source: Source, registry: AdapterRegistry = adapters): SourceAdapter {
  const a = registry[source];
  if (!a) throw new Error(`unknown source ${source}`);
  return a;
}
