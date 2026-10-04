import type { Kind, Source } from "../../../shared/constants";
import { numberIn } from "../html";
import { nuxtDataByPrefix } from "../nuxt";
import { asNumber, asRecord, asString, parseAreaLabel, parseWarsawLocal, pricePerM2, round2, stripHtml } from "../parse-utils";
import type { NormalizedListing } from "../types";

/**
 * Gratka and Morizon run the same Nuxt platform (Grupa Morizon-Gratka): identical payload shapes, shared internal ids.
 * The parsers below are used by both adapters; only origins and URL grammars differ.
 */
export interface MgListPage {
  items: NormalizedListing[];
  total: number | null;
  pageSize: number;
  parseErrors: number;
}

export const MG_DEFAULT_PAGE_SIZE = 35;

function locationParts(node: Record<string, unknown>): { parts: string[]; street: string | null } {
  const location = asRecord(node.location);
  const parts = Array.isArray(location?.location) ? location!.location.map((p) => asString(p) ?? "") : [];
  return { parts, street: location ? asString(location.street) : null };
}

export function parseMgNode(raw: unknown, kind: Kind, source: Source, origin: string): NormalizedListing | null {
  const node = asRecord(raw);
  if (!node) return null;
  const publicId = asString(node.idOnFrontend) ?? (node.id != null ? String(node.id) : null);
  const path = asString(node.url);
  const title = asString(node.advertisementText) ?? asString(node.title);
  if (!publicId || !path || !title) return null;

  const price = asRecord(node.price);
  const priceAmount = price ? asNumber(price.amount) : null;
  const ppm = asRecord(node.priceM2);
  const areaM2 = numberIn(asString(node.area));
  const { parts, street } = locationParts(node);
  const contact = asRecord(node.contact);
  const company = asRecord(contact?.company);
  const person = asRecord(contact?.person);
  const companyType = company ? asString(company.type) : null;
  const companyId = company ? asNumber(company.id) : null;
  const added = asString(node.addedAt);
  const createdAt = added ? parseWarsawLocal(`${added} 00:00:00`) : null;
  const refreshedAt = parseWarsawLocal(node.refreshedAt) ?? createdAt;

  return {
    source,
    sourceId: publicId,
    url: path.startsWith("http") ? path : `${origin}${path}`,
    title,
    kind,
    price: priceAmount !== null && priceAmount > 0 ? Math.round(priceAmount) : null,
    priceNegotiable: false,
    areaM2,
    plotAreaM2: null,
    pricePerM2: (ppm ? round2(asNumber(ppm.amount)) : null) ?? pricePerM2(priceAmount !== null && priceAmount > 0 ? Math.round(priceAmount) : null, areaM2),
    rooms: kind === "house" ? numberIn(asString(node.numberOfRooms)) : null,
    plotType: null,
    lat: null,
    lon: null,
    locationPrecision: "unknown",
    locationRadiusKm: null,
    city: parts[3] || parts[2] || null,
    district: parts[4] || null,
    region: parts[0] || null,
    isPrivate: companyType === "OWNER" ? true : companyType ? false : null,
    advertiserName: (company ? asString(company.name) : null) ?? (person ? asString(person.name) : null),
    // Shared between Gratka and Morizon on purpose: the same agency id lets dedup recognise the cross-posted ad.
    advertiserId: companyId !== null ? `mg-agency:${companyId}` : null,
    attributes: {
      internalId: node.id ?? null,
      gmina: parts[2] || null,
      powiat: parts[1] || null,
      street,
      companyType,
      promoted: Boolean(node.isTopPromoted || node.isHighlighted || node.isRecommended),
      photosNumber: asNumber(node.photosNumber),
      hasVideo: Boolean(node.hasVideo),
      development: node.development != null,
    },
    descriptionExcerpt: stripHtml(node.description),
    sourceCreatedAt: createdAt,
    sourceRefreshedAt: refreshedAt,
    validTo: null,
  };
}

export function parseMgListing(payload: unknown, kind: Kind, source: Source, origin: string): MgListPage {
  const listing = asRecord(nuxtDataByPrefix(payload, "property-listing-data-"));
  const searchResult = asRecord(asRecord(listing?.data)?.searchResult);
  const properties = asRecord(searchResult?.properties);
  if (!properties) throw new Error(`${source} payload has no searchResult.properties`);
  const nodes = Array.isArray(properties.nodes) ? properties.nodes : [];
  const items: NormalizedListing[] = [];
  let parseErrors = 0;
  const seen = new Set<string>();
  for (const raw of nodes) {
    const item = parseMgNode(raw, kind, source, origin);
    if (!item) {
      parseErrors += 1;
      continue;
    }
    if (seen.has(item.sourceId)) continue;
    seen.add(item.sourceId);
    items.push(item);
  }
  const decoded = asRecord(nuxtDataByPrefix(payload, "decode-listing-url-query-"));
  const params = asRecord(asRecord(asRecord(decoded?.data)?.decodeListingUrl)?.listingParameters);
  const pageSize = (params ? asNumber(params.numberOfResults) : null) ?? MG_DEFAULT_PAGE_SIZE;
  return { items, total: asNumber(properties.totalCount), pageSize, parseErrors };
}

export interface MgAd {
  active: boolean;
  lat: number | null;
  lon: number | null;
  hasStreet: boolean;
  plotAreaM2: number | null;
  plotType: string | null;
  addedAt: Date | null;
  descriptionExcerpt: string | null;
  details: Record<string, string>;
}

/** `propertyData` of an ad page; coordinates are a locality/street-level geocode, never an exact pin. */
export function parseMgAd(payload: unknown): MgAd | null {
  const details = asRecord(nuxtDataByPrefix(payload, "property-details-"));
  const property = asRecord(asRecord(details?.data)?.propertyData);
  if (!property) return null;
  const location = asRecord(property.location);
  const center = asRecord(asRecord(location?.map)?.center);
  const info: Record<string, string> = {};
  for (const list of [property.detailedInformation, property.buildingDetailedInformation, property.offerDetailedInformation]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const rec = asRecord(entry);
      const label = rec ? asString(rec.label) : null;
      const value = rec ? asString(rec.value) : null;
      if (label && value) info[label] = value;
    }
  }
  let plotAreaM2 = parseAreaLabel(info["Pow. działki"]);
  // Agents sometimes type hectares into the m² field ("0,15 m²" for 1 500 m²).
  if (plotAreaM2 !== null && plotAreaM2 < 10) plotAreaM2 = Math.round(plotAreaM2 * 10_000);
  const addedRaw = info["Data dodania"]?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const addedAt = addedRaw ? parseWarsawLocal(`${addedRaw[3]}-${addedRaw[2]}-${addedRaw[1]} 00:00:00`) : null;
  const presentation = asString(property.presentationType);
  return {
    active: (presentation === null || presentation === "ACTIVE") && !property.archiveCategoryRedirectUrl,
    lat: center ? asNumber(center.latitude) : null,
    lon: center ? asNumber(center.longitude) : null,
    hasStreet: Boolean(location && asString(location.street)),
    plotAreaM2: plotAreaM2 !== null ? Math.round(plotAreaM2) : null,
    plotType: info["Typ działki"]?.toLowerCase() ?? null,
    addedAt,
    descriptionExcerpt: stripHtml(property.description),
    details: info,
  };
}
