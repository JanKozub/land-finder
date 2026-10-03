import { OLX_PAGE_SIZE } from "../../../shared/constants";

export const OLX_API_BASE = "https://www.olx.pl/api/v1/offers/";

/** Headers that are known to pass OLX's CloudFront rules from Node: nothing beyond UA + Accept. */
export const OLX_JSON_HEADERS: Record<string, string> = { Accept: "application/json" };
export const OLX_HTML_HEADERS: Record<string, string> = { Accept: "text/html" };

export interface OlxQuery {
  categoryId: number;
  cityId: number;
  distanceKm: number;
  offset: number;
  limit?: number;
  priceFrom?: number | null;
  priceTo?: number | null;
}

export function buildOlxOffersUrl(q: OlxQuery): string {
  const u = new URL(OLX_API_BASE);
  u.searchParams.set("offset", String(q.offset));
  u.searchParams.set("limit", String(q.limit ?? OLX_PAGE_SIZE));
  u.searchParams.set("category_id", String(q.categoryId));
  u.searchParams.set("city_id", String(q.cityId));
  u.searchParams.set("distance", String(q.distanceKm));
  u.searchParams.set("sort_by", "created_at:desc");
  if (q.priceFrom != null && q.priceFrom > 0) u.searchParams.set("filter_float_price:from", String(q.priceFrom));
  if (q.priceTo != null) u.searchParams.set("filter_float_price:to", String(q.priceTo));
  return u.toString();
}

export function buildOlxSearchUrl(q: string, categoryId?: number, limit = 50): string {
  const u = new URL(OLX_API_BASE);
  u.searchParams.set("offset", "0");
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("q", q);
  if (categoryId) u.searchParams.set("category_id", String(categoryId));
  return u.toString();
}
