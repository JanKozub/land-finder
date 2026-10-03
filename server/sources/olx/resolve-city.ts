import { OLX_CATEGORY } from "../../../shared/constants";
import type { FetchClient } from "../../http/fetch-client";
import { asNumber, asRecord, asString } from "../parse-utils";
import { OLX_HTML_HEADERS, OLX_JSON_HEADERS, buildOlxSearchUrl } from "./client";

export interface OlxCityCandidate {
  id: number;
  name: string;
  region: string | null;
  count: number;
}

export function slugifyPolish(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Finds OLX `city_id` candidates for a town name.
 * 1) the server-rendered search page for that town embeds the city id in its state;
 * 2) fallback: full-text search results whose `location.city.normalized_name` matches the slug.
 * This is best-effort: the UI always allows typing the id by hand.
 */
export async function resolveOlxCity(client: FetchClient, town: string): Promise<OlxCityCandidate[]> {
  const slug = slugifyPolish(town);
  if (!slug) return [];
  const found = new Map<number, OlxCityCandidate>();

  try {
    const res = await client.get(`https://www.olx.pl/nieruchomosci/dzialki/sprzedaz/${slug}/`, OLX_HTML_HEADERS);
    if (res.status === 200) {
      const re = /\\?"city_id\\?":\s*\\?"?(\d+)/g;
      const counts = new Map<number, number>();
      for (const m of res.text.matchAll(re)) {
        const id = Number(m[1]);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      for (const [id, count] of counts) found.set(id, { id, name: town, region: null, count });
    }
  } catch {
    // fall through to the API-based fallback
  }

  for (const categoryId of [OLX_CATEGORY.plot, OLX_CATEGORY.house, undefined]) {
    if (found.size >= 3) break;
    try {
      const res = await client.get(buildOlxSearchUrl(town, categoryId), OLX_JSON_HEADERS);
      if (res.status !== 200) continue;
      const json = asRecord(JSON.parse(res.text));
      const data = Array.isArray(json?.data) ? json!.data : [];
      for (const entry of data) {
        const offer = asRecord(entry);
        const city = asRecord(asRecord(offer?.location)?.city);
        const region = asRecord(asRecord(offer?.location)?.region);
        const id = city ? asNumber(city.id) : null;
        const normalized = city ? asString(city.normalized_name) : null;
        const name = city ? asString(city.name) : null;
        if (id === null || !name) continue;
        if (normalized !== slug && slugifyPolish(name) !== slug) continue;
        const existing = found.get(id);
        if (existing) existing.count += 1;
        else found.set(id, { id, name, region: region ? asString(region.name) : null, count: 1 });
      }
    } catch {
      // ignore and try the next query
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
}
