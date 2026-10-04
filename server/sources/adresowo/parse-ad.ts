import { hasJsonLdType, jsonLdNodes, parseDocument, textOf } from "../html";
import { asNumber, asRecord, parseAreaLabel } from "../parse-utils";

export interface AdresowoAd {
  lat: number | null;
  lon: number | null;
  /** Metres, from the portal's own map circle (0 = exact pin). */
  radiusM: number | null;
  city: string | null;
  gmina: string | null;
  powiat: string | null;
  region: string | null;
  plotAreaM2: number | null;
  priceNegotiable: boolean;
  isPrivate: boolean | null;
  /** "dodana wczoraj" → 1, "dodana 3 dni temu" → 3, "dodana dzisiaj" → 0; null when unknown. */
  addedDaysAgo: number | null;
  params: Record<string, string>;
}

function reVar(html: string, name: string): string | null {
  const m = html.match(new RegExp(`re\\.geo\\.${name}\\s*=\\s*("((?:[^"\\\\]|\\\\.)*)"|[-\\d.]+)\\s*;`));
  if (!m) return null;
  if (m[2] !== undefined) {
    try {
      return JSON.parse(`"${m[2]}"`) as string;
    } catch {
      return m[2];
    }
  }
  return m[1] ?? null;
}

export function parseRelativeDays(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/dzisiaj|dziś|przed chwil|godzin|minut/.test(t)) return 0;
  if (/wczoraj/.test(t)) return 1;
  const m = t.match(/(\d+)\s*(dni|dzień|tyg|mies)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2]!.startsWith("tyg")) return n * 7;
  if (m[2]!.startsWith("mies")) return n * 30;
  return n;
}

/** Ad page → coordinates from the inline `re.geo` object (JSON-LD Place as fallback), parameters and seller line. */
export function parseAdresowoAd(html: string): AdresowoAd | null {
  const publicCode = html.match(/re\.publicCode\s*=\s*'([^']*)'/)?.[1];
  const place = jsonLdNodes(html).find((n) => hasJsonLdType(n, "Place") && n.geo);
  const geo = asRecord(place?.geo);
  if (!publicCode && !geo) return null;

  let lat = asNumber(reVar(html, "lat"));
  let lon = asNumber(reVar(html, "lng"));
  if (lat === null || lon === null) {
    lat = geo ? asNumber(geo.latitude) : null;
    lon = geo ? asNumber(geo.longitude) : null;
  }
  const radiusM = asNumber(reVar(html, "radius"));

  const doc = parseDocument(html);
  const params: Record<string, string> = {};
  let plotAreaM2: number | null = null;
  let priceNegotiable = false;
  let isPrivate: boolean | null = null;
  let addedDaysAgo: number | null = null;
  for (const li of doc.querySelectorAll("li")) {
    const spans = li.querySelectorAll(":scope > div > span.block");
    if (spans.length < 1) continue;
    const label = textOf(spans[0]);
    const value = textOf(spans[1]) ?? "";
    if (!label) continue;
    if (/^działka\s+[\d\s,.]+\s*(m²|m2|a|ar|ha)/i.test(label)) plotAreaM2 = parseAreaLabel(label.replace(/^działka\s+/i, ""));
    else if (/cena do negocjacji/i.test(label)) priceNegotiable = true;
    else if (/bezpośrednio od właściciela/i.test(label)) {
      isPrivate = true;
      addedDaysAgo = parseRelativeDays(value);
    } else if (/oferta (od|przez) (agent|biur)/i.test(label)) {
      isPrivate = false;
      addedDaysAgo = parseRelativeDays(value);
    } else if (value && value !== " ") params[label] = value;
  }
  return {
    lat,
    lon,
    radiusM,
    city: reVar(html, "city"),
    gmina: reVar(html, "region3"),
    powiat: reVar(html, "region2"),
    region: reVar(html, "region1"),
    plotAreaM2: plotAreaM2 !== null ? Math.round(plotAreaM2) : null,
    priceNegotiable,
    isPrivate,
    addedDaysAgo,
    params,
  };
}
