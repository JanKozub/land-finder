import type { Kind } from "../../../shared/constants";

export const DOMIPORTA_ORIGIN = "https://www.domiporta.pl";
export const DOMIPORTA_PAGE_SIZE = 36;
export const DOMIPORTA_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "pl-PL,pl;q=0.9",
};

const CATEGORY_PATH: Record<Kind, string> = { plot: "dzialke", house: "dom" };

/** `location` is "<voivodeship>/<town>" as in Domiporta URLs, e.g. "malopolskie/wieliczka". */
export function buildDomiportaListUrl(p: { kind: Kind; location: string; radiusKm: number; page: number }): string {
  const location = p.location.trim().replace(/^\/+|\/+$/g, "");
  const u = new URL(`${DOMIPORTA_ORIGIN}/${CATEGORY_PATH[p.kind]}/sprzedam/${location}`);
  u.searchParams.set("Distance", String(Math.max(0, Math.round(p.radiusKm))));
  u.searchParams.set("SortingOrderDirection", "InsertionDateDescending");
  u.searchParams.set("PageNumber", String(p.page));
  return u.toString();
}
