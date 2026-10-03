import type { Kind, Source } from "@shared/constants";

export const KIND_LABEL: Record<Kind, string> = { plot: "Działka", house: "Dom" };
export const KIND_LABEL_PLURAL: Record<Kind, string> = { plot: "Działki", house: "Domy" };
export const SOURCE_LABEL: Record<Source, string> = { olx: "OLX", otodom: "Otodom" };

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
