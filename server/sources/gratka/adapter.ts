import type { Kind } from "../../../shared/constants";
import { createMgAdapter } from "./shared-adapter";

export const GRATKA_ORIGIN = "https://gratka.pl";
const CATEGORY_PATH: Record<Kind, string> = { plot: "dzialki-grunty", house: "domy" };

/** `location` as in Gratka URLs: `wieliczka` (town), `gmina-wieliczka`, `powiat-wielicki`, `krakow`. */
export function buildGratkaListUrl(p: { kind: Kind; location: string; page: number }): string {
  const location = p.location.trim().replace(/^\/+|\/+$/g, "");
  return `${GRATKA_ORIGIN}/nieruchomosci/${CATEGORY_PATH[p.kind]}/${location}${p.page > 1 ? `?page=${p.page}` : ""}`;
}

export const gratkaAdapter = createMgAdapter({
  id: "gratka",
  label: "Gratka",
  origin: GRATKA_ORIGIN,
  settingsOf: (settings) => settings.gratka,
  listUrl: buildGratkaListUrl,
});
