import type { Kind } from "../../../shared/constants";

export const ADRESOWO_ORIGIN = "https://adresowo.pl";
export const ADRESOWO_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "pl-PL,pl;q=0.9",
};

const CATEGORY_PATH: Record<Kind, string> = { plot: "dzialki", house: "domy" };

/**
 * `location` is a slug from Adresowo URLs: `powiat-wielicki`, `gmina-wieliczka` or a locality slug with its
 * suffix (`wieliczka-1`). A radius (`g<km>`) is only meaningful for locality slugs and is served under `/f/`.
 */
export function buildAdresowoListUrl(p: { kind: Kind; location: string; radiusKm: number }): string {
  const location = p.location.trim().replace(/^\/+|\/+$/g, "");
  if (p.radiusKm > 0) return `${ADRESOWO_ORIGIN}/f/${CATEGORY_PATH[p.kind]}/${location}/g${Math.round(p.radiusKm)}`;
  return `${ADRESOWO_ORIGIN}/${CATEGORY_PATH[p.kind]}/${location}/`;
}

export function absoluteAdresowoUrl(href: string): string {
  return href.startsWith("http") ? href : `${ADRESOWO_ORIGIN}${href.startsWith("/") ? "" : "/"}${href}`;
}
