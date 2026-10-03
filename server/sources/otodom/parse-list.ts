import type { Kind } from "../../../shared/constants";
import { asNumber, asRecord, asString, parseIsoDate, parseWarsawLocal, pricePerM2 } from "../parse-utils";
import type { NormalizedListing } from "../types";
import { OTODOM_ORIGIN } from "./search-url";

const ROOM_WORDS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
  NINE: 9,
  TEN: 10,
  MORE: 11,
};

export function parseRooms(v: unknown): number | null {
  if (typeof v === "number") return v;
  const s = asString(v);
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  return ROOM_WORDS[s.toUpperCase()] ?? null;
}

/** Pulls the JSON out of Next.js' `__NEXT_DATA__` script tag. */
export function extractNextData(html: string): unknown {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!);
  } catch {
    return null;
  }
}

/** Both the HTML payload (`props.pageProps`) and the `_next/data` payload (`pageProps`) are accepted. */
export function pagePropsOf(data: unknown): Record<string, unknown> | null {
  const root = asRecord(data);
  if (!root) return null;
  const props = asRecord(root.props);
  return asRecord(props?.pageProps) ?? asRecord(root.pageProps);
}

export function buildIdOf(data: unknown): string | null {
  const root = asRecord(data);
  return root ? asString(root.buildId) : null;
}

function geoLevel(item: Record<string, unknown>, level: string): string | null {
  const location = asRecord(item.location);
  const rg = asRecord(location?.reverseGeocoding);
  const locations = Array.isArray(rg?.locations) ? rg!.locations : [];
  for (const l of locations) {
    const rec = asRecord(l);
    if (rec && rec.locationLevel === level) return asString(rec.name);
  }
  return null;
}

export function estateToKind(estate: unknown): Kind | null {
  if (estate === "TERRAIN") return "plot";
  if (estate === "HOUSE") return "house";
  return null;
}

export function parseOtodomItem(raw: unknown, expectedKind: Kind): NormalizedListing | null {
  const it = asRecord(raw);
  if (!it) return null;
  const id = it.id;
  if (typeof id !== "number" && typeof id !== "string") return null;
  const slug = asString(it.slug);
  const title = asString(it.title);
  if (!slug || !title) return null;
  const kind = estateToKind(it.estate) ?? expectedKind;

  const totalPrice = asRecord(it.totalPrice);
  const priceValue = totalPrice ? asNumber(totalPrice.value) : null;
  const currency = totalPrice ? asString(totalPrice.currency) : null;
  const price = priceValue !== null && priceValue > 0 && (!currency || currency === "PLN") && !it.hidePrice ? Math.round(priceValue) : null;

  const areaM2 = asNumber(it.areaInSquareMeters);
  const plotAreaM2 = kind === "house" ? asNumber(it.terrainAreaInSquareMeters) : null;
  const ppm = asRecord(it.pricePerSquareMeter);

  const location = asRecord(it.location);
  const address = asRecord(location?.address);
  const addressCity = asRecord(address?.city);
  const street = asRecord(address?.street);
  const mapDetails = asRecord(location?.mapDetails);
  const agency = asRecord(it.agency);
  const owner = asRecord(it.advertOwner);

  const isPrivate = typeof it.isPrivateOwner === "boolean" ? it.isPrivateOwner : null;
  const attributes: Record<string, unknown> = {
    advertiserType: asString(it.extendedAdvertiserType),
    feedSource: asString(it.source),
    isCrossListed: Boolean(it.isCrossListed),
    agencyId: agency ? asNumber(agency.id) : null,
    agencyName: agency ? asString(agency.name) : null,
    street: street ? asString(street.name) : null,
    pushedUpAt: asString(it.pushedUpAt),
  };

  const createdFirst = parseIsoDate(it.createdAtFirst);
  const created = parseWarsawLocal(it.dateCreated);

  return {
    source: "otodom",
    sourceId: String(id),
    url: `${OTODOM_ORIGIN}/pl/oferta/${slug}`,
    title,
    kind,
    price,
    priceNegotiable: false,
    areaM2,
    plotAreaM2,
    pricePerM2: (ppm ? asNumber(ppm.value) : null) ?? pricePerM2(price, areaM2),
    rooms: parseRooms(it.roomsNumber),
    plotType: null,
    lat: null,
    lon: null,
    locationPrecision: "unknown",
    locationRadiusKm: mapDetails ? asNumber(mapDetails.radius) : null,
    city: (addressCity ? asString(addressCity.name) : null) ?? geoLevel(it, "city_or_village"),
    district: geoLevel(it, "district"),
    region: geoLevel(it, "voivodeship"),
    isPrivate,
    advertiserName: (agency ? asString(agency.name) : null) ?? (owner ? asString(owner.name) : null),
    advertiserId: agency && agency.id != null ? `agency:${String(agency.id)}` : owner ? asString(owner.name) : null,
    attributes,
    descriptionExcerpt: asString(it.shortDescription)?.slice(0, 500) ?? null,
    sourceCreatedAt: createdFirst ?? created,
    sourceRefreshedAt: parseIsoDate(it.pushedUpAt) ?? created ?? createdFirst,
    validTo: null,
  };
}

export interface OtodomSearchPage {
  items: NormalizedListing[];
  total: number | null;
  totalPages: number | null;
  currentPage: number | null;
  buildId: string | null;
  parseErrors: number;
}

export function parseOtodomSearch(data: unknown, kind: Kind): OtodomSearchPage {
  const pageProps = pagePropsOf(data);
  const dataNode = asRecord(pageProps?.data);
  const searchAds = asRecord(dataNode?.searchAds);
  if (!searchAds) throw new Error("Otodom payload has no searchAds");
  const rawItems = Array.isArray(searchAds.items) ? searchAds.items : [];
  const items: NormalizedListing[] = [];
  let parseErrors = 0;
  const seen = new Set<string>();
  for (const entry of rawItems) {
    const parsed = parseOtodomItem(entry, kind);
    if (!parsed) {
      parseErrors += 1;
      continue;
    }
    if (seen.has(parsed.sourceId)) continue; // promoted ads repeat within a page
    seen.add(parsed.sourceId);
    items.push(parsed);
  }
  const pagination = asRecord(searchAds.pagination);
  return {
    items,
    total: pagination ? asNumber(pagination.totalItems) : null,
    totalPages: pagination ? asNumber(pagination.totalPages) : null,
    currentPage: pagination ? asNumber(pagination.currentPage) : null,
    buildId: buildIdOf(data),
    parseErrors,
  };
}
