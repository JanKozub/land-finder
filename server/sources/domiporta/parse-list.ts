import type { Kind } from "../../../shared/constants";
import { decodeHtmlEntities, hasJsonLdType, jsonLdNodes, numberIn, parseDocument, textOf } from "../html";
import { asNumber, asRecord, asString, parseAreaLabel, parseWarsawLocal, pricePerM2, round2 } from "../parse-utils";
import type { NormalizedListing } from "../types";
import { DOMIPORTA_ORIGIN, DOMIPORTA_PAGE_SIZE } from "./search-url";

export interface DomiportaListPage {
  items: NormalizedListing[];
  total: number | null;
  totalPages: number | null;
  hasNext: boolean;
  parseErrors: number;
}

function idFromUrl(url: string | null): string | null {
  const m = url?.match(/\/(\d+)\/?$/);
  return m ? m[1]! : null;
}

/** JSON-LD `ItemList` entries keyed by ad id; cards carry the few fields JSON-LD lacks (plot area of houses, rooms). */
function jsonLdItems(html: string): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const node of jsonLdNodes(html)) {
    if (!hasJsonLdType(node, "ItemList") || !Array.isArray(node.itemListElement)) continue;
    for (const entry of node.itemListElement) {
      const item = asRecord(asRecord(entry)?.item);
      const id = idFromUrl(item ? asString(item.url) : null);
      if (item && id) map.set(id, item);
    }
  }
  return map;
}

export function parseDomiportaList(html: string, kind: Kind): DomiportaListPage {
  const doc = parseDocument(html);
  const ld = jsonLdItems(html);
  const items: NormalizedListing[] = [];
  let parseErrors = 0;
  const seen = new Set<string>();

  for (const card of doc.querySelectorAll("article.sneakpeak[data-detail-id]")) {
    const id = card.getAttribute("data-detail-id")?.trim();
    const href = card.querySelector('a[href^="/nieruchomosci/"]')?.getAttribute("href") ?? null;
    if (!id || !href || seen.has(id)) continue;
    if (href.includes("/DPRP/") || href.includes("/nowe/")) continue; // new-build developer cards
    const g = ld.get(id);
    const offers = asRecord(g?.offers);
    const offered = asRecord(offers?.itemOffered);
    const address = asRecord(offered?.address);
    const seller = asRecord(offers?.seller);

    const title = textOf(card.querySelector("h2.sneakpeak__title--bold")) ?? (g ? asString(g.name)?.split(":")[0]?.trim() ?? null : null);
    if (!title) {
      parseErrors += 1;
      continue;
    }
    const priceText = textOf(card.querySelector(".sneakpeak__price_value"));
    const ldPrice = offers ? asNumber(offers.price) : null;
    const price = ldPrice !== null && ldPrice > 0 ? Math.round(ldPrice) : priceText && !/zapytaj/i.test(priceText) ? numberIn(priceText) : null;
    const areaM2 = (offered ? asNumber(asRecord(offered.floorSize)?.value) : null) ?? numberIn(textOf(card.querySelector(".sneakpeak__details_item--area")));
    // House cards state the plot in hectares ("0,0310 ha"); anything below 10 m² is an agent's typo, not a plot.
    const plotAreaRaw = kind === "house" ? parseAreaLabel(textOf(card.querySelector(".sneakpeak__details_item--area-h"))) : null;
    const plotAreaM2 = plotAreaRaw !== null && plotAreaRaw >= 10 ? plotAreaRaw : null;
    const ppmLd = offers ? asNumber(asRecord(offers.priceSpecification)?.price) : null;
    const sellerType = seller ? asString(seller["@type"]) : null;
    const datePosted = g ? asString(g.datePosted) : null;
    const created = datePosted ? parseWarsawLocal(`${datePosted} 00:00:00`) : null;

    seen.add(id);
    items.push({
      source: "domiporta",
      sourceId: id,
      url: (g ? asString(g.url) : null) ?? `${DOMIPORTA_ORIGIN}${href}`,
      title: decodeHtmlEntities(title),
      kind,
      price,
      priceNegotiable: false,
      areaM2,
      plotAreaM2: plotAreaM2 !== null ? Math.round(plotAreaM2) : null,
      pricePerM2: (ppmLd !== null ? round2(ppmLd) : null) ?? pricePerM2(price, areaM2),
      rooms: numberIn(textOf(card.querySelector(".sneakpeak__details_item--room"))),
      plotType: null,
      lat: null,
      lon: null,
      locationPrecision: "unknown",
      locationRadiusKm: null,
      city: address ? asString(address.addressLocality) : null,
      district: null,
      region: address ? asString(address.addressRegion) : null,
      isPrivate: sellerType === "Organization" || sellerType === "RealEstateAgent" ? false : sellerType === "Person" ? true : null,
      advertiserName: seller ? asString(seller.name) : null,
      advertiserId: seller && asString(seller.name) ? `domiporta:${asString(seller.name)!.toLowerCase()}` : null,
      attributes: {
        street: address ? asString(address.streetAddress) : null,
        promoted: Boolean(card.querySelector(".sneakpeak__type--normal")),
        sellerType,
      },
      descriptionExcerpt: textOf(card.querySelector("p.sneakpeak__description"))?.slice(0, 500) ?? null,
      sourceCreatedAt: created,
      sourceRefreshedAt: created,
      validTo: null,
    });
  }

  const summary = textOf(doc.querySelector("span.summary__title")) ?? "";
  const total = numberIn(summary.match(/Znaleziono\s+([\d\s]+)/)?.[1] ?? null);
  return {
    items,
    total,
    totalPages: total === null ? null : Math.max(1, Math.ceil(total / DOMIPORTA_PAGE_SIZE)),
    hasNext: Boolean(doc.querySelector("li.pagination__link--right")),
    parseErrors,
  };
}
