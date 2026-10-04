import { TZDate } from "@date-fns/tz";
import type { Kind } from "../../../shared/constants";
import { decodeHtmlEntities, hasJsonLdType, jsonLdNodes, numberIn } from "../html";
import { asNumber, asRecord, asString, parseAreaLabel, pricePerM2, round2 } from "../parse-utils";
import type { NormalizedListing } from "../types";
import { NO_PAGE_SIZE } from "./search-url";

const MONTHS: Record<string, number> = {
  stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6, lipca: 7, sierpnia: 8, września: 9, października: 10, listopada: 11, grudnia: 12,
};

/** "30 września 2026" → Date (Europe/Warsaw midnight). */
export function parsePolishDate(v: unknown): Date | null {
  const s = asString(v);
  const m = s?.match(/^(\d{1,2})\s+([a-ząćęłńóśźż]+)\s+(\d{4})$/i);
  if (!m) return null;
  const month = MONTHS[m[2]!.toLowerCase()];
  if (!month) return null;
  return new Date(new TZDate(Number(m[3]), month - 1, Number(m[1]), 0, 0, 0, "Europe/Warsaw").getTime());
}

/** Brace-matches the JSON value that follows `tilesData:` in the page's `modules.list.init({...})` call. */
export function extractTilesData(html: string): Record<string, unknown> | null {
  const at = html.indexOf("tilesData:");
  if (at === -1) return null;
  const start = html.indexOf("{", at);
  const arrayStart = html.indexOf("[", at);
  if (arrayStart !== -1 && (start === -1 || arrayStart < start)) return {}; // `tilesData: []` past the last page
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

interface LdOffer {
  areaM2: number | null;
  pricePerM2: number | null;
  street: string | null;
  rooms: number | null;
  description: string | null;
}

/** JSON-LD `CollectionPage` offers keyed by ad id (the only place with the area in m²). */
function ldOffers(html: string): Map<string, LdOffer> {
  const map = new Map<string, LdOffer>();
  for (const node of jsonLdNodes(html)) {
    if (!hasJsonLdType(node, "CollectionPage")) continue;
    const entity = asRecord(node.mainEntity);
    let offers: unknown[] = Array.isArray(entity?.offers) ? entity!.offers : [];
    const first = asRecord(offers[0]);
    if (first && Array.isArray(first.offers)) offers = first.offers;
    for (const raw of offers) {
      const offer = asRecord(raw);
      const id = offer ? asString(offer.url)?.match(/\/(\d+)\.html/)?.[1] : null;
      if (!offer || !id) continue;
      const offered = asRecord(offer.itemOffered);
      const address = asRecord(offered?.address);
      map.set(id, {
        areaM2: offered ? asNumber(asRecord(offered.floorSize)?.value) : null,
        pricePerM2: asNumber(asRecord(offer.priceSpecification)?.price),
        street: address ? asString(address.streetAddress) : null,
        rooms: offered ? asNumber(offered.numberOfRooms) : null,
        description: offered ? asString(offered.description) : null,
      });
    }
  }
  return map;
}

function attributeMap(tile: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(tile.attributes)) return out;
  for (const raw of tile.attributes) {
    const attr = asRecord(raw);
    const label = attr ? asString(attr.label) : null;
    const values = Array.isArray(attr?.values) ? attr!.values : [];
    const text = values
      .map((v) => asString(asRecord(v)?.value))
      .filter((v): v is string => v !== null)
      .map(decodeHtmlEntities)
      .join(", ");
    if (label && text) out[label] = text;
  }
  return out;
}

export interface NoListPage {
  items: NormalizedListing[];
  total: number | null;
  totalPages: number | null;
  parseErrors: number;
}

export function parseNoTile(key: string, raw: unknown, ld: LdOffer | undefined, kind: Kind): NormalizedListing | null {
  const tile = asRecord(raw);
  if (!tile) return null;
  const id = key.includes("_") ? key.slice(key.indexOf("_") + 1) : key.replace(/^a/, "");
  const url = asString(tile.shareUrl);
  const title = asString(tile.h1) ?? asString(tile.metaTitle);
  if (!/^\d+$/.test(id) || !url || !title) return null;
  const dl = asRecord(tile.dlData);
  const map = asRecord(tile.map);
  const contact = asRecord(tile.contactBox);
  const attrs = attributeMap(tile);
  const priceRaw = asNumber(tile.primaryPrice);
  const price = priceRaw !== null && priceRaw > 0 ? Math.round(priceRaw) : null;
  const areaM2 = ld?.areaM2 ?? parseAreaLabel(asString(tile.metaTitle)?.match(/(\d[\d\s]*)\s*m²/)?.[1] ?? null);
  let lat = map ? asNumber(map.latitude) : null;
  let lon = map ? asNumber(map.longitude) : null;
  if (lat === null || lon === null || (lat === 0 && lon === 0)) {
    lat = null;
    lon = null;
  }
  const exact = map ? asNumber(map.isInaccurateLocation) === 0 : false;
  const publisher = dl ? asString(dl.publisher) : null;
  const modDate = parsePolishDate(tile.modDate);
  const changeDate = parsePolishDate(tile.changeDate);
  const companyName = contact ? asString(contact.companyName) : null;
  const personName = contact ? (asString(contact.nameShow) ?? asString(contact.personName)) : null;
  const idAccount = asString(tile.idAccount);

  return {
    source: "nieruchomosci_online",
    sourceId: id,
    url,
    title: decodeHtmlEntities(title),
    kind,
    price,
    priceNegotiable: false,
    areaM2,
    plotAreaM2: kind === "house" ? parseAreaLabel(attrs["Powierzchnia działki"] ?? null) : null,
    pricePerM2: (ld?.pricePerM2 !== null && ld?.pricePerM2 !== undefined ? round2(ld.pricePerM2) : null) ?? pricePerM2(price, areaM2),
    rooms: kind === "house" ? (numberIn(attrs["Liczba pokoi"]) ?? ld?.rooms ?? null) : null,
    plotType: kind === "plot" ? (attrs["Rodzaj działki"]?.toLowerCase() ?? null) : null,
    lat,
    lon,
    locationPrecision: lat === null ? "unknown" : exact ? "exact" : "approx",
    locationRadiusKm: lat === null ? null : exact ? 0 : 1,
    city: dl ? asString(dl.cityName) : null,
    district: dl ? asString(dl.quarterName) : null,
    region: dl ? asString(dl.regionName) : null,
    isPrivate: publisher === null ? null : publisher === "priv",
    advertiserName: companyName ?? personName,
    advertiserId: idAccount ? `no:${idAccount}` : null,
    attributes: {
      street: ld?.street ?? null,
      publisher,
      accuracy: map ? asString(map.accuracy) : null,
      market: asString(tile.market),
      isHot: asNumber(tile.isHot) === 1,
      thermometer: asNumber(tile.thermometer),
      params: attrs,
    },
    descriptionExcerpt: ld?.description?.slice(0, 500) ?? null,
    sourceCreatedAt: modDate,
    sourceRefreshedAt: changeDate ?? modDate,
    validTo: null,
  };
}

export function parseNoList(html: string, kind: Kind): NoListPage {
  const tiles = extractTilesData(html);
  if (!tiles) throw new Error("nieruchomosci-online page has no tilesData");
  const ld = ldOffers(html);
  const items: NormalizedListing[] = [];
  let parseErrors = 0;
  const seen = new Set<string>();
  for (const [key, raw] of Object.entries(tiles)) {
    const tile = asRecord(raw);
    if (!tile || tile.isSupplementAd === true || asString(tile.isArchive) === "1") continue;
    const id = key.includes("_") ? key.slice(key.indexOf("_") + 1) : key.replace(/^a/, "");
    const item = parseNoTile(key, raw, ld.get(id), kind);
    if (!item) {
      parseErrors += 1;
      continue;
    }
    if (seen.has(item.sourceId)) continue;
    seen.add(item.sourceId);
    items.push(item);
  }
  const total = numberIn(html.match(/id="boxOfCounter"[^>]*data-counter="(\d+)"/)?.[1] ?? null);
  return { items, total, totalPages: total === null ? null : Math.max(1, Math.ceil(total / NO_PAGE_SIZE)), parseErrors };
}
