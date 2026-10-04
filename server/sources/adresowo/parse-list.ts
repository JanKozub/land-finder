import type { Kind } from "../../../shared/constants";
import { numberIn, parseDocument, textOf } from "../html";
import { pricePerM2 } from "../parse-utils";
import type { NormalizedListing } from "../types";
import { absoluteAdresowoUrl } from "./search-url";

export interface AdresowoListPage {
  items: NormalizedListing[];
  total: number | null;
  nextUrl: string | null;
  /** Empty when the portal did not recognise the location slug (it then serves an empty "/f/" view). */
  resolvedLocation: string | null;
  parseErrors: number;
}

function kindFromLabel(label: string | null, fallback: Kind): Kind {
  if (!label) return fallback;
  if (/^dom/i.test(label)) return "house";
  if (/^dzia/i.test(label)) return "plot";
  return fallback;
}

export function parseAdresowoList(html: string, kind: Kind): AdresowoListPage {
  const doc = parseDocument(html);
  const scope = doc.querySelector("#offer-list-results") ?? doc;
  const items: NormalizedListing[] = [];
  let parseErrors = 0;
  const seen = new Set<string>();

  for (const card of scope.querySelectorAll("[data-offer-card][data-id]")) {
    const id = card.getAttribute("data-id")?.trim();
    const link = card.querySelector('a[data-track="offer-link"]');
    const href = link?.getAttribute("href");
    if (!id || !href || seen.has(id)) continue;
    const title = card.querySelector("img[alt]")?.getAttribute("alt")?.trim() || textOf(link);
    if (!title) {
      parseErrors += 1;
      continue;
    }
    let price: number | null = null;
    let priceOnRequest = false;
    let areaM2: number | null = null;
    let rooms: number | null = null;
    for (const p of card.querySelectorAll("p.flex-auto")) {
      const text = textOf(p) ?? "";
      const bold = textOf(p.querySelector("span.font-bold"));
      if (/zapytaj/i.test(text)) priceOnRequest = true;
      else if (/zł/.test(text) && bold) price = numberIn(bold);
      else if (/m²|m2/.test(text) && bold) areaM2 = numberIn(bold);
      else if (/pok/.test(text) && bold) rooms = numberIn(bold);
    }
    const nameSpans = card.querySelectorAll("h2 span.line-clamp-1").map((s) => textOf(s));
    // "bez pośredników" (private) is bold, "przez agenta" is not; both sit in a `span.shrink-0`.
    const sellerText = card.querySelectorAll("span.shrink-0").map((s) => textOf(s)).find((t) => t && /(bez po|agent)/i.test(t)) ?? "";
    const isPrivate = /bez po/i.test(sellerText) ? true : /agent/i.test(sellerText) ? false : null;
    const itemKind = kindFromLabel(textOf(card.querySelector("span.mr-1.truncate")), kind);

    seen.add(id);
    items.push({
      source: "adresowo",
      sourceId: id,
      url: absoluteAdresowoUrl(href),
      title,
      kind: itemKind,
      price: priceOnRequest ? null : price,
      priceNegotiable: false,
      areaM2,
      plotAreaM2: null,
      pricePerM2: pricePerM2(price, areaM2),
      rooms: itemKind === "house" ? rooms : null,
      plotType: null,
      lat: null,
      lon: null,
      locationPrecision: "unknown",
      locationRadiusKm: null,
      city: nameSpans[0] ?? null,
      district: null,
      region: null,
      isPrivate,
      advertiserName: null,
      advertiserId: null,
      attributes: { street: nameSpans[1] ?? null, publicCode: href.split("-").pop() ?? null, isNew: /nowe/i.test(textOf(card.querySelector("[data-badge]")) ?? "") },
      descriptionExcerpt: textOf(card.querySelector("p.line-clamp-4"))?.slice(0, 500) ?? null,
      sourceCreatedAt: null,
      sourceRefreshedAt: null,
      validTo: null,
    });
  }

  const next = doc.querySelector('link[rel="next"]')?.getAttribute("href") ?? null;
  const resolved = html.match(/re\.autocompletedSearch\s*=\s*'([^']*)'/)?.[1] ?? null;
  return {
    items,
    total: numberIn(html.match(/re\.totalOffers\s*=\s*(\d+)/)?.[1] ?? null),
    nextUrl: next ? absoluteAdresowoUrl(next) : null,
    resolvedLocation: resolved ? resolved : null,
    parseErrors,
  };
}
