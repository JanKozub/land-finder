import type { Filters, ListingDto, ListingsPageDto, ListingsQuery, PropertyDetailDto, PropertyDto, RunDto, ScrapeMode, ScrapeStatusDto, Settings } from "@shared/schemas";
import { filtersToQuery, listingsQueryToParams } from "@shared/schemas";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw new ApiClientError(res.status, json);
  return json as T;
}

export interface PropertiesResponse {
  items: PropertyDto[];
  total: number;
  center: { lat: number; lon: number };
  radiusKm: number;
}

export interface SliceResponse {
  summary: { skipped: "locked" | null; processed: number; completed: number; paused: number; failed: number; notified: number };
  status: ScrapeStatusDto;
}

export interface OlxCityCandidate {
  id: number;
  name: string;
  region: string | null;
  count: number;
}

export interface OtodomValidation {
  locationPath: string;
  estate: string;
  radiusKm: number;
  totalWithRadius: number | null;
  totalWithoutRadius: number | null;
  radiusIgnored: boolean;
  suggestedPath: string | null;
  suggestedTotal: number | null;
}

export const api = {
  properties: (filters: Partial<Filters>) => request<PropertiesResponse>("GET", `/api/properties?${new URLSearchParams(filtersToQuery(filters))}`),
  property: (id: number) => request<PropertyDetailDto>("GET", `/api/properties/${id}`),
  listings: (query: Partial<ListingsQuery>) => request<ListingsPageDto>("GET", `/api/listings?${new URLSearchParams(listingsQueryToParams(query))}`),
  hide: (id: number, hidden: boolean) => request<PropertyDto>("POST", `/api/properties/${id}/hide`, { hidden }),
  favorite: (id: number, favorite: boolean) => request<PropertyDto>("POST", `/api/properties/${id}/favorite`, { favorite }),
  ignoreProperty: (id: number, ignored: boolean) => request<PropertyDto>("POST", `/api/properties/${id}/ignore`, { ignored }),
  note: (id: number, note: string | null) => request<PropertyDto>("PATCH", `/api/properties/${id}`, { note }),
  merge: (id: number, sourcePropertyId: number) => request<PropertyDto>("POST", `/api/properties/${id}/merge`, { sourcePropertyId }),
  detach: (listingId: number) => request<{ propertyId: number }>("POST", `/api/listings/${listingId}/detach`),
  ignoreListing: (listingId: number, ignored: boolean) =>
    request<{ listing: ListingDto; property: PropertyDto | null }>("POST", `/api/listings/${listingId}/ignore`, { ignored }),
  settings: () => request<Settings>("GET", "/api/settings"),
  saveSettings: (s: Settings) => request<Settings>("PUT", "/api/settings", s),
  olxCities: (q: string) => request<{ candidates: OlxCityCandidate[] }>("GET", `/api/olx/cities?q=${encodeURIComponent(q)}`),
  validateOtodom: (url: string) => request<OtodomValidation>("POST", "/api/otodom/validate-url", { url }),
  startScrape: (mode: ScrapeMode) => request<{ run: RunDto; jobs: number }>("POST", "/api/scrape", { mode }),
  scrapeStatus: () => request<ScrapeStatusDto>("GET", "/api/scrape/status"),
  runs: (limit = 20) => request<{ runs: RunDto[] }>("GET", `/api/scrape/runs?limit=${limit}`),
  cancelScrape: () => request<{ cancelled: number }>("POST", "/api/scrape/cancel"),
  workerSlice: () => request<SliceResponse>("POST", "/api/worker/slice"),
  notifyTest: () => request<{ sent: string[] }>("POST", "/api/notify/test"),
  health: () => request<{ ok: boolean; db: string }>("GET", "/api/health"),
};
