import { decodeHtmlEntities, hasJsonLdType, jsonLdNodes, parseDocument, textOf } from "../html";
import { asNumber, asRecord, asString } from "../parse-utils";

export interface DomiportaAd {
  lat: number | null;
  lon: number | null;
  plotType: string | null;
  isPrivate: boolean | null;
  areaM2: number | null;
  attributes: Record<string, unknown>;
}

function commaNumber(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Ad page → coordinates (JSON-LD `itemOffered.geo`, falling back to the map meta tags), plot type, advertiser type. */
export function parseDomiportaAd(html: string): DomiportaAd | null {
  const listing = jsonLdNodes(html).find((n) => hasJsonLdType(n, "RealEstateListing") && n.itemOffered);
  const offered = asRecord(listing?.itemOffered);
  const geo = asRecord(offered?.geo);
  let lat = geo ? asNumber(geo.latitude) : null;
  let lon = geo ? asNumber(geo.longitude) : null;
  if (lat === null || lon === null) {
    lat = commaNumber(html.match(/itemprop="latitude"\s+content="([^"]+)"/)?.[1]);
    lon = commaNumber(html.match(/itemprop="longitude"\s+content="([^"]+)"/)?.[1]);
  }
  if (!listing && lat === null) return null;

  const props: Record<string, string> = {};
  if (Array.isArray(offered?.additionalProperty)) {
    for (const p of offered!.additionalProperty) {
      const rec = asRecord(p);
      const name = rec ? asString(rec.name) : null;
      const value = rec ? asString(rec.value) : null;
      if (name && value) props[name] = value;
    }
  }
  const doc = parseDocument(html);
  const features: Record<string, string> = {};
  for (const li of doc.querySelectorAll("ul.features__list-2 li").slice(0, 40)) {
    const name = textOf(li.querySelector(".features__item_name"));
    const value = textOf(li.querySelector(".features__item_value"));
    if (name && value) features[name.replace(/:$/, "")] = value;
  }
  const advertiserType = html.match(/'advertiserType'\s*:\s*'([^']*)'/)?.[1];
  const advertiser = advertiserType ? decodeHtmlEntities(advertiserType).toLowerCase() : null;
  const plotType = props["Rodzaj działki"] ?? features["Rodzaj działki"] ?? null;
  return {
    lat,
    lon,
    plotType: plotType ? plotType.toLowerCase() : null,
    isPrivate: advertiser === null ? null : advertiser === "agencja" ? false : true,
    areaM2: offered ? asNumber(asRecord(offered.floorSize)?.value) : null,
    attributes: { advertiserType: advertiser, properties: props, features, offerNumber: html.match(/Numer oferty:&nbsp;([^<]+)</)?.[1]?.trim() ?? null },
  };
}
