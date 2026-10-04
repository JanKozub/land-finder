import type { Kind } from "../../../shared/constants";

export const NO_ORIGIN = "https://www.nieruchomosci-online.pl";
export const NO_PAGE_SIZE = 41;
export const NO_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "pl-PL,pl;q=0.9",
};

const CATEGORY: Record<Kind, string> = { plot: "dzialka", house: "dom" };

/**
 * Positional search query: `3,<category>,sprzedaz,,<City[:id]>,,,<radiusKm>` (+ `&p=N` from page 2).
 * `location` is the town name, ideally with the portal's city id ("Wieliczka:32080").
 */
export function buildNoListUrl(p: { kind: Kind; location: string; radiusKm: number; page: number }): string {
  const location = encodeURIComponent(p.location.trim()).replace(/%3A/gi, ":");
  let query = `3,${CATEGORY[p.kind]},sprzedaz,,${location}`;
  if (p.radiusKm > 0) query += `,,,${Math.round(p.radiusKm)}`;
  return `${NO_ORIGIN}/szukaj.html?${query}${p.page > 1 ? `&p=${p.page}` : ""}`;
}
