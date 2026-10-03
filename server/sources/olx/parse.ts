import type { Kind } from "../../../shared/constants";
import { OLX_CATEGORY } from "../../../shared/constants";
import {
  asNumber,
  asRecord,
  asString,
  isHttpsUrl,
  parseAreaLabel,
  parseIsoDate,
  pricePerM2,
  stripHtml,
} from "../parse-utils";
import type { NormalizedListing } from "../types";

interface OlxParam {
  key: string;
  value: Record<string, unknown> | null;
}

function paramsOf(offer: Record<string, unknown>): Map<string, OlxParam> {
  const out = new Map<string, OlxParam>();
  const params = Array.isArray(offer.params) ? offer.params : [];
  for (const p of params) {
    const rec = asRecord(p);
    const key = rec ? asString(rec.key) : null;
    if (rec && key) out.set(key, { key, value: asRecord(rec.value) });
  }
  return out;
}

function numericParam(p: OlxParam | undefined): number | null {
  if (!p?.value) return null;
  return asNumber(p.value.key) ?? parseAreaLabel(p.value.label) ?? asNumber(p.value.value);
}

function selectLabel(p: OlxParam | undefined): string | null {
  return p?.value ? (asString(p.value.label) ?? asString(p.value.key)) : null;
}

function selectKey(p: OlxParam | undefined): string | null {
  return p?.value ? (asString(p.value.key) ?? asString(p.value.label)) : null;
}

export function kindForOlxCategory(categoryId: number | null): Kind | null {
  if (categoryId === OLX_CATEGORY.plot) return "plot";
  if (categoryId === OLX_CATEGORY.house) return "house";
  return null;
}

/** Converts one OLX offer object into a NormalizedListing; returns null when essential fields are missing. */
export function parseOlxOffer(raw: unknown, expectedKind: Kind): NormalizedListing | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = o.id;
  if (typeof id !== "number" && typeof id !== "string") return null;
  if (!isHttpsUrl(o.url)) return null;
  const title = asString(o.title);
  if (!title) return null;

  const category = asRecord(o.category);
  const categoryId = category ? asNumber(category.id) : null;
  const kind = kindForOlxCategory(categoryId) ?? expectedKind;

  const params = paramsOf(o);
  const priceParam = params.get("price")?.value ?? null;
  let price: number | null = null;
  if (priceParam) {
    const value = asNumber(priceParam.value);
    const currency = asString(priceParam.currency);
    if (value !== null && value > 0 && (!currency || currency === "PLN")) price = Math.round(value);
  }
  const priceNegotiable = Boolean(priceParam?.negotiable);

  const m = numericParam(params.get("m"));
  const area = numericParam(params.get("area"));
  const areaM2 = m;
  const plotAreaM2 = kind === "house" ? area : null;

  const map = asRecord(o.map);
  const lat = map ? asNumber(map.lat) : null;
  const lon = map ? asNumber(map.lon) : null;
  const radius = map ? asNumber(map.radius) : null;
  const hasCoords = lat !== null && lon !== null;

  const location = asRecord(o.location);
  const city = asRecord(location?.city);
  const district = asRecord(location?.district);
  const region = asRecord(location?.region);
  const user = asRecord(o.user);

  const attributes: Record<string, unknown> = {
    categoryId,
    market: selectLabel(params.get("market")),
    builtType: selectLabel(params.get("builttype")),
    floors: selectLabel(params.get("floor_select")),
    typeLabel: selectLabel(params.get("type")),
    pricePerM2Label: selectLabel(params.get("price_per_m")),
    arranged: Boolean(priceParam?.arranged),
    offerType: asString(o.offer_type),
    partner: asRecord(o.partner) ? (asString(asRecord(o.partner)!.code) ?? true) : null,
    cityId: city ? asNumber(city.id) : null,
    regionId: region ? asNumber(region.id) : null,
  };

  return {
    source: "olx",
    sourceId: String(id),
    url: o.url,
    title,
    kind,
    price,
    priceNegotiable,
    areaM2,
    plotAreaM2,
    pricePerM2: numericParam(params.get("price_per_m")) ?? pricePerM2(price, areaM2),
    rooms: null,
    plotType: kind === "plot" ? selectKey(params.get("type")) : null,
    lat: hasCoords ? lat : null,
    lon: hasCoords ? lon : null,
    locationPrecision: hasCoords ? (radius === 0 ? "exact" : "approx") : "unknown",
    locationRadiusKm: hasCoords ? radius : null,
    city: city ? asString(city.name) : null,
    district: district ? asString(district.name) : null,
    region: region ? asString(region.name) : null,
    isPrivate: typeof o.business === "boolean" ? !o.business : null,
    advertiserName: user ? asString(user.name) : null,
    advertiserId: user && user.id != null ? String(user.id) : null,
    attributes,
    descriptionExcerpt: stripHtml(o.description),
    sourceCreatedAt: parseIsoDate(o.created_time),
    sourceRefreshedAt: parseIsoDate(o.last_refresh_time) ?? parseIsoDate(o.pushup_time) ?? parseIsoDate(o.created_time),
    validTo: parseIsoDate(o.valid_to_time),
  };
}

export interface OlxOffersPage {
  items: NormalizedListing[];
  total: number | null;
  parseErrors: number;
  hasNextLink: boolean;
}

export function parseOlxOffersResponse(raw: unknown, kind: Kind): OlxOffersPage {
  const root = asRecord(raw);
  const data = Array.isArray(root?.data) ? root!.data : null;
  if (!data) throw new Error("OLX response has no data array");
  const items: NormalizedListing[] = [];
  let parseErrors = 0;
  for (const entry of data) {
    const parsed = parseOlxOffer(entry, kind);
    if (parsed) items.push(parsed);
    else parseErrors += 1;
  }
  const metadata = asRecord(root!.metadata);
  const total = metadata ? asNumber(metadata.total_elements) : null;
  const links = asRecord(root!.links);
  return { items, total, parseErrors, hasNextLink: Boolean(links && asRecord(links.next)) };
}
