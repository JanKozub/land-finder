import type { Kind } from "../../../shared/constants";
import { createMgAdapter } from "../gratka/shared-adapter";

export const MORIZON_ORIGIN = "https://www.morizon.pl";
const CATEGORY_PATH: Record<Kind, string> = { plot: "dzialki", house: "domy" };

/** `location` as in Morizon URLs: `wielicki` (powiat), `wielicki/miasto-wieliczka`, `wielicki/gmina-wieliczka`. */
export function buildMorizonListUrl(p: { kind: Kind; location: string; page: number }): string {
  const location = p.location.trim().replace(/^\/+|\/+$/g, "");
  return `${MORIZON_ORIGIN}/${CATEGORY_PATH[p.kind]}/${location}/${p.page > 1 ? `?page=${p.page}` : ""}`;
}

export const morizonAdapter = createMgAdapter({
  id: "morizon",
  label: "Morizon",
  origin: MORIZON_ORIGIN,
  settingsOf: (settings) => settings.morizon,
  listUrl: buildMorizonListUrl,
});
