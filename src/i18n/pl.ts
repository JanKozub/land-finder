import { SOURCE_LABELS, type Kind, type Source } from "@shared/constants";
import type { S7Kind } from "@shared/s7";

export const KIND_LABEL: Record<Kind, string> = { plot: "Działka", house: "Dom" };
export const KIND_LABEL_PLURAL: Record<Kind, string> = { plot: "Działki", house: "Domy" };
export const SOURCE_LABEL: Record<Source, string> = SOURCE_LABELS;

/** One-line notes per portal shown next to the automatically derived search settings. */
export const PORTAL_NOTES: Partial<Record<Source, string>> = {
  olx: "Szuka w promieniu od miasta najbliższego środka obszaru (OLX nie ma wyszukiwania po współrzędnych).",
  otodom: "Promień od gminy w środku obszaru; portal czasem ignoruje promień — sprawdź przyciskiem.",
  nieruchomosci_online: "Promień liczony od miejscowości, więc pojedyncze oferty bywają dalej; odpadają przy filtrze obszaru.",
  domiporta: "Promień od miejscowości w środku obszaru.",
  gratka: "Bez promienia: przeszukiwane są gminy objęte prostokątem.",
  morizon: "Ten sam system i te same oferty co Gratka — włącz tylko jeden z nich.",
  adresowo: "Bez promienia: przeszukiwane są gminy objęte prostokątem.",
};

export const MODE_LABEL = {
  incremental: "Pobierz nowe oferty",
  backfill: "Pełne pobranie",
  sweep: "Sprawdź wygasłe",
} as const;

export const RUN_STATUS_LABEL = {
  running: "w toku",
  done: "zakończony",
  partial: "zakończony z błędami",
  failed: "nieudany",
  cancelled: "anulowany",
} as const;

export const JOB_STATUS_LABEL = {
  queued: "w kolejce",
  running: "w toku",
  done: "gotowe",
  failed: "błąd",
  cancelled: "anulowane",
} as const;

export const TRIGGER_LABEL = { manual: "ręcznie", schedule: "harmonogram", cli: "lokalnie" } as const;

export const S7_KIND_LABEL: Record<S7Kind, string> = {
  axis: "oś S7",
  axisTunnel: "oś S7 w tunelu",
  bdi: "oś BDI (Beskidzka Droga Integracyjna)",
  bdiTunnel: "oś BDI w tunelu",
  tunnel: "tunel",
  bridge: "estakada / most",
  interchange: "węzeł drogowy",
  interchangeName: "węzeł drogowy",
  extent: "zakres budowy lub przebudowy",
  km: "kilometraż",
};
