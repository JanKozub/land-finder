import { OTODOM_PAGE_SIZE } from "../../../shared/constants";

export const OTODOM_ORIGIN = "https://www.otodom.pl";
export const OTODOM_HTML_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "pl-PL,pl;q=0.9",
};
export const OTODOM_JSON_HEADERS: Record<string, string> = {
  Accept: "*/*",
  "Accept-Language": "pl-PL,pl;q=0.9",
  "x-nextjs-data": "1",
};

export interface OtodomSearchParams {
  estate: string;
  locationPath: string;
  radiusKm: number;
  page: number;
  limit?: number;
}

export interface ParsedOtodomUrl {
  transaction: string;
  estate: string | null;
  locationPath: string;
  radiusKm: number | null;
}

/** Parses a pasted Otodom search URL into its path parts. Returns null when it is not a search URL. */
export function parseOtodomSearchUrl(input: string): ParsedOtodomUrl | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/otodom\.pl$/i.test(url.hostname)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const idx = segments.indexOf("wyniki");
  if (idx === -1) return null;
  const rest = segments.slice(idx + 1);
  const transaction = rest[0];
  if (!transaction) return null;
  const estate = rest[1] ?? null;
  const location = rest.slice(2).map((s) => decodeURIComponent(s).toLowerCase());
  const radiusRaw = url.searchParams.get("distanceRadius");
  const radiusKm = radiusRaw !== null && radiusRaw !== "" ? Number(radiusRaw) : null;
  return {
    transaction,
    estate,
    locationPath: location.join("/"),
    radiusKm: radiusKm !== null && Number.isFinite(radiusKm) ? radiusKm : null,
  };
}

export function buildOtodomListHtmlUrl(p: OtodomSearchParams): string {
  const u = new URL(`${OTODOM_ORIGIN}/pl/wyniki/sprzedaz/${p.estate}/${p.locationPath}`);
  u.searchParams.set("distanceRadius", String(p.radiusKm));
  u.searchParams.set("limit", String(p.limit ?? OTODOM_PAGE_SIZE));
  u.searchParams.set("page", String(p.page));
  u.searchParams.set("by", "LATEST");
  u.searchParams.set("direction", "DESC");
  u.searchParams.set("viewType", "listing");
  return u.toString();
}

export function buildOtodomListJsonUrl(buildId: string, p: OtodomSearchParams): string {
  const u = new URL(`${OTODOM_ORIGIN}/_next/data/${buildId}/pl/wyniki/sprzedaz/${p.estate}/${p.locationPath}.json`);
  u.searchParams.append("searchingCriteria", "sprzedaz");
  u.searchParams.append("searchingCriteria", p.estate);
  for (const seg of p.locationPath.split("/")) u.searchParams.append("searchingCriteria", seg);
  u.searchParams.set("distanceRadius", String(p.radiusKm));
  u.searchParams.set("limit", String(p.limit ?? OTODOM_PAGE_SIZE));
  u.searchParams.set("page", String(p.page));
  u.searchParams.set("by", "LATEST");
  u.searchParams.set("direction", "DESC");
  return u.toString();
}

export function buildOtodomAdHtmlUrl(slug: string): string {
  return `${OTODOM_ORIGIN}/pl/oferta/${slug}`;
}

export function buildOtodomAdJsonUrl(buildId: string, slug: string): string {
  return `${OTODOM_ORIGIN}/_next/data/${buildId}/pl/oferta/${slug}.json?slug=${encodeURIComponent(slug)}`;
}

export function slugFromOtodomUrl(url: string): string | null {
  const m = url.match(/\/pl\/oferta\/([^/?#]+)/);
  return m ? m[1]! : null;
}
