/**
 * Reduces real portal responses to small, faithful test fixtures (first few items, no photos/descriptions).
 * Used by scripts/record-fixture.ts; the parsers under test read the same markup/JSON they see in production.
 */
import { parseDocument } from "../../server/sources/html";
import { extractNuxtData } from "../../server/sources/nuxt";
import { extractTilesData } from "../../server/sources/nieruchomosci-online/parse-list";

const JSON_LD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi;

function jsonLdScripts(html: string): string[] {
  return [...html.matchAll(JSON_LD_RE)].map((m) => m[0]);
}

function wrap(parts: string[]): string {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"></head><body>\n${parts.join("\n")}\n</body></html>\n`;
}

export function trimDomiportaList(html: string, n = 6): string {
  const doc = parseDocument(html);
  const articles = doc.querySelectorAll("article.sneakpeak[data-detail-id]").slice(0, n);
  const ids = new Set(articles.map((a) => a.getAttribute("data-detail-id")));
  const ld = jsonLdScripts(html).map((script) => {
    const body = script.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const json = JSON.parse(body) as { "@graph"?: Array<Record<string, unknown>> };
      for (const node of json["@graph"] ?? []) {
        if (node["@type"] === "ItemList" && Array.isArray(node.itemListElement)) {
          node.itemListElement = (node.itemListElement as Array<{ item?: { url?: string; description?: string; image?: string } }>)
            .filter((e) => ids.has(e.item?.url?.split("/").pop() ?? ""))
            .map((e) => ({ ...e, item: { ...e.item, description: e.item?.description?.slice(0, 120), image: undefined } }));
        }
      }
      return `<script type="application/ld+json">${JSON.stringify(json)}</script>`;
    } catch {
      return "";
    }
  });
  const summary = doc.querySelector("span.summary__title")?.outerHTML ?? "";
  const next = doc.querySelector("li.pagination__link--right")?.outerHTML ?? "";
  return wrap([summary, ...ld, ...articles.map((a) => a.outerHTML), next ? `<ul class="pagination">${next}</ul>` : ""]);
}

export function trimDomiportaAd(html: string): string {
  const doc = parseDocument(html);
  const dataLayer = html.match(/dataLayer\.push\(\{[\s\S]*?'advertId'[\s\S]*?\}\);/)?.[0] ?? "";
  const metas = [...html.matchAll(/<meta itemprop="(latitude|longitude)" content="[^"]*"\s*\/?>/g)].map((m) => m[0]);
  const features = doc.querySelector("ul.features__list-2")?.outerHTML ?? "";
  return wrap([...jsonLdScripts(html), `<script>${dataLayer}</script>`, ...metas, features]);
}

export function trimAdresowoList(html: string, n = 6): string {
  const doc = parseDocument(html);
  const cards = (doc.querySelector("#offer-list-results") ?? doc).querySelectorAll("[data-offer-card][data-id]").slice(0, n);
  const vars = [...html.matchAll(/re\.(totalOffers|autocompletedSearch|idType)\s*=\s*[^;]*;/g)].map((m) => m[0]).join(" ");
  const next = doc.querySelector('link[rel="next"]')?.outerHTML ?? "";
  return wrap([`<script>${vars}</script>`, next, `<div id="offer-list-results">${cards.map((c) => c.outerHTML).join("\n")}</div>`]);
}

export function trimAdresowoAd(html: string): string {
  const doc = parseDocument(html);
  const vars = [...html.matchAll(/re\.(publicCode|publicURL|geo(?:\.\w+)?)\s*=\s*[^;]*;/g)].map((m) => m[0]).join("\n");
  const h1 = doc.querySelector("h1")?.outerHTML ?? "";
  const accuracy = doc.querySelector("#map-accuracy")?.outerHTML ?? "";
  const lists = doc.querySelectorAll("ul").filter((ul) => ul.querySelectorAll("li span.block").length >= 4).map((ul) => ul.outerHTML);
  return wrap([`<script>${vars}</script>`, ...jsonLdScripts(html), h1, accuracy, ...lists]);
}

type Dict = Record<string, unknown>;

function trimNode(node: Dict, descriptionChars = 160): Dict {
  const out: Dict = { ...node, photos: [], description: typeof node.description === "string" ? node.description.slice(0, descriptionChars) : node.description };
  return out;
}

/** Decoded Nuxt payload of a Gratka/Morizon list page reduced to the keys the parser reads. */
export function trimNuxtListing(html: string, n = 6): Dict | null {
  const payload = extractNuxtData(html) as { data?: Dict } | null;
  if (!payload?.data) return null;
  const data: Dict = {};
  for (const [key, value] of Object.entries(payload.data)) {
    if (key.startsWith("property-listing-data-")) {
      const sr = ((value as Dict).data as Dict).searchResult as Dict;
      const props = sr.properties as { nodes: Dict[]; totalCount: number };
      data[key] = { data: { searchResult: { properties: { nodes: props.nodes.slice(0, n).map((x) => trimNode(x)), totalCount: props.totalCount } } } };
    } else if (key.startsWith("decode-listing-url-query-")) {
      const dec = ((value as Dict).data as Dict).decodeListingUrl as Dict;
      const lp = dec.listingParameters as Dict;
      data[key] = { data: { decodeListingUrl: { totalCount: dec.totalCount, listingParameters: { numberOfResults: lp.numberOfResults, pageNumber: lp.pageNumber, searchOrder: lp.searchOrder, locations: lp.locations } } } };
    }
  }
  return { data };
}

export function trimNuxtAd(html: string): Dict | null {
  const payload = extractNuxtData(html) as { data?: Dict } | null;
  if (!payload?.data) return null;
  const data: Dict = {};
  for (const [key, value] of Object.entries(payload.data)) {
    if (!key.startsWith("property-details-")) continue;
    const pd = ((value as Dict).data as Dict).propertyData as Dict;
    const keep = ["id", "idOnFrontend", "url", "title", "advertisementText", "area", "price", "priceM2", "location", "detailedInformation", "buildingDetailedInformation", "offerDetailedInformation", "presentationType", "archiveCategoryRedirectUrl", "reference", "types", "transaction", "marketType", "addedAt", "refreshedAt", "lastModified"];
    const trimmed: Dict = {};
    for (const k of keep) trimmed[k] = pd[k];
    trimmed.description = typeof pd.description === "string" ? pd.description.slice(0, 200) : null;
    data[key] = { data: { propertyData: trimmed } };
  }
  return { data };
}

export function trimNoList(html: string, n = 6): string {
  const tiles = extractTilesData(html) ?? {};
  const keys = Object.keys(tiles).slice(0, n);
  const kept: Dict = {};
  for (const k of keys) {
    const t = { ...(tiles[k] as Dict) };
    delete t.rodoTermsParagraph;
    delete t.thermometerDictionary;
    delete t.adContactDefaultMessage;
    kept[k] = t;
  }
  const ids = new Set(keys.map((k) => (k.includes("_") ? k.slice(k.indexOf("_") + 1) : k.replace(/^a/, ""))));
  const ld = jsonLdScripts(html).map((script) => {
    const body = script.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const json = JSON.parse(body) as { "@type"?: string; mainEntity?: { offers?: Array<{ url?: string; offers?: unknown[]; itemOffered?: { description?: string } }> } };
      if (json["@type"] !== "CollectionPage" || !json.mainEntity?.offers) return "";
      let offers = json.mainEntity.offers;
      if (offers[0] && Array.isArray(offers[0].offers)) offers = offers[0].offers as typeof offers;
      json.mainEntity.offers = offers
        .filter((o) => ids.has(o.url?.match(/\/(\d+)\.html/)?.[1] ?? ""))
        .map((o) => ({ ...o, image: undefined, itemOffered: { ...o.itemOffered, description: o.itemOffered?.description?.slice(0, 120) } }));
      return `<script type="application/ld+json">${JSON.stringify(json)}</script>`;
    } catch {
      return "";
    }
  });
  const counter = html.match(/<span id="boxOfCounter"[^>]*>[^<]*<\/span>/)?.[0] ?? "";
  const searchValues = html.match(/searchValues:\s*(\{[^\n]*?\}),\s*tests/)?.[1] ?? "{}";
  return wrap([counter, ...ld, `<script>modules.list.init({ tilesData: ${JSON.stringify(kept)}, searchValues: ${searchValues}, areAds: ${keys.length ? 1 : 0} });</script>`]);
}
