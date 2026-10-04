import { mkdirSync, writeFileSync } from "node:fs";
import { OLX_CATEGORY } from "../shared/constants";
import { createFetchClient } from "../server/http/fetch-client";
import { ADRESOWO_HEADERS, buildAdresowoListUrl } from "../server/sources/adresowo/search-url";
import { DOMIPORTA_HEADERS, buildDomiportaListUrl } from "../server/sources/domiporta/search-url";
import { buildGratkaListUrl } from "../server/sources/gratka/adapter";
import { MG_HEADERS } from "../server/sources/gratka/shared-adapter";
import { buildMorizonListUrl } from "../server/sources/morizon/adapter";
import { NO_HEADERS, buildNoListUrl } from "../server/sources/nieruchomosci-online/search-url";
import { OLX_JSON_HEADERS, buildOlxOffersUrl } from "../server/sources/olx/client";
import { extractNextData } from "../server/sources/otodom/parse-list";
import { OTODOM_HTML_HEADERS, buildOtodomListHtmlUrl } from "../server/sources/otodom/search-url";
import { trimAdresowoAd, trimAdresowoList, trimDomiportaAd, trimDomiportaList, trimNoList, trimNuxtAd, trimNuxtListing } from "./lib/trim-fixtures";

/**
 * Records trimmed real responses as test fixtures (photos/descriptions removed).
 * Usage: pnpm fixtures:record [olx,otodom,domiporta,adresowo,gratka,morizon,nieruchomosci_online]
 * (needs network access; defaults to all portals, ~1.5 s between requests)
 */
async function main() {
  const client = createFetchClient();
  const only = new Set((process.argv[2] ?? "olx,otodom,domiporta,adresowo,gratka,morizon,nieruchomosci_online").split(","));
  for (const dir of ["olx", "otodom", "domiporta", "adresowo", "gratka", "morizon", "nieruchomosci-online"]) mkdirSync(`tests/fixtures/${dir}`, { recursive: true });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const html = async (url: string, headers: Record<string, string>): Promise<string | null> => {
    const res = await client.get(url, headers);
    await sleep(1500);
    if (res.status !== 200) {
      console.warn(`${url}: HTTP ${res.status} — fixture not updated`);
      return null;
    }
    return res.text;
  };
  const save = (file: string, body: string) => {
    writeFileSync(file, body);
    console.log(`${file}: ${Math.round(body.length / 1024)} KB`);
  };
  /** First ad URL of a trimmed list fixture, so the ad fixture always belongs to a listed item. */
  const firstHref = (page: string, re: RegExp) => page.match(re)?.[1] ?? null;

  if (only.has("domiporta")) {
    for (const [kind, name] of [["plot", "list-plots"], ["house", "list-houses"]] as const) {
      const page = await html(buildDomiportaListUrl({ kind, location: "malopolskie/wieliczka", radiusKm: 15, page: 1 }), DOMIPORTA_HEADERS);
      if (!page) continue;
      const trimmed = trimDomiportaList(page);
      save(`tests/fixtures/domiporta/${name}.html`, trimmed);
      const href = firstHref(trimmed, /href="(\/nieruchomosci\/[^"]+)"/);
      const ad = href ? await html(`https://www.domiporta.pl${href}`, DOMIPORTA_HEADERS) : null;
      if (ad) save(`tests/fixtures/domiporta/ad-${kind}.html`, trimDomiportaAd(ad));
    }
  }
  if (only.has("adresowo")) {
    for (const [kind, name] of [["plot", "list-plots"], ["house", "list-houses"]] as const) {
      const page = await html(buildAdresowoListUrl({ kind, location: "powiat-wielicki", radiusKm: 0 }), ADRESOWO_HEADERS);
      if (!page) continue;
      const trimmed = trimAdresowoList(page);
      save(`tests/fixtures/adresowo/${name}.html`, trimmed);
      const href = firstHref(trimmed, /href="(\/o\/[^"]+)"/);
      const ad = href ? await html(`https://adresowo.pl${href}`, ADRESOWO_HEADERS) : null;
      if (ad) save(`tests/fixtures/adresowo/ad-${kind}.html`, trimAdresowoAd(ad));
    }
    const empty = await html("https://adresowo.pl/dzialki/wieliczka/", ADRESOWO_HEADERS);
    if (empty) save("tests/fixtures/adresowo/list-empty.html", trimAdresowoList(empty));
  }
  if (only.has("gratka")) {
    for (const [kind, name] of [["plot", "list-plots"], ["house", "list-houses"]] as const) {
      const page = await html(buildGratkaListUrl({ kind, location: "powiat-wielicki", page: 1 }), MG_HEADERS);
      const listing = page ? trimNuxtListing(page) : null;
      if (!listing) continue;
      save(`tests/fixtures/gratka/${name}.json`, JSON.stringify(listing, null, 1));
      const url = JSON.stringify(listing).match(/"url":"(\/nieruchomosci\/[^"]+)"/)?.[1];
      const ad = url ? await html(`https://gratka.pl${url}`, MG_HEADERS) : null;
      const trimmedAd = ad ? trimNuxtAd(ad) : null;
      if (trimmedAd) save(`tests/fixtures/gratka/ad-${kind}.json`, JSON.stringify(trimmedAd, null, 1));
    }
  }
  if (only.has("morizon")) {
    const page = await html(buildMorizonListUrl({ kind: "plot", location: "wielicki", page: 1 }), MG_HEADERS);
    const listing = page ? trimNuxtListing(page) : null;
    if (listing) save("tests/fixtures/morizon/list-plots.json", JSON.stringify(listing, null, 1));
  }
  if (only.has("nieruchomosci_online")) {
    for (const [kind, name] of [["plot", "list-plots"], ["house", "list-houses"]] as const) {
      const page = await html(buildNoListUrl({ kind, location: "Wieliczka:32080", radiusKm: 15, page: 1 }), NO_HEADERS);
      if (page) save(`tests/fixtures/nieruchomosci-online/${name}.html`, trimNoList(page));
    }
    const end = await html(buildNoListUrl({ kind: "plot", location: "Wieliczka:32080", radiusKm: 15, page: 999 }), NO_HEADERS);
    if (end) save("tests/fixtures/nieruchomosci-online/list-end.html", trimNoList(end));
  }

  if (!only.has("olx")) return otodom();
  for (const [kind, name] of [["plot", "offers-plots-p1"], ["house", "offers-houses-p1"]] as const) {
    const url = buildOlxOffersUrl({ categoryId: OLX_CATEGORY[kind], cityId: 128097, distanceKm: 15, offset: 0 });
    const res = await client.get(url, OLX_JSON_HEADERS);
    if (res.status !== 200) {
      console.warn(`OLX ${kind}: HTTP ${res.status} — fixture not updated`);
    } else {
      const json = JSON.parse(res.text) as { data: Record<string, unknown>[]; metadata: unknown; links: unknown };
      const trimmed = {
        data: json.data.slice(0, 6).map((o) => ({ ...o, photos: undefined, description: String(o.description ?? "").slice(0, 300) })),
        metadata: json.metadata,
        links: json.links,
      };
      writeFileSync(`tests/fixtures/olx/${name}.json`, JSON.stringify(trimmed, null, 1));
      console.log(`OLX ${kind}: saved ${trimmed.data.length} offers`);
    }
    await sleep(2500);
  }

  await otodom();
}

async function otodom() {
  const client = createFetchClient();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const [estate, name] of [["dzialka", "search-dzialka-p1"], ["dom", "search-dom-p1"]] as const) {
    const url = buildOtodomListHtmlUrl({ estate, locationPath: "malopolskie/wielicki/wieliczka", radiusKm: 15, page: 1, limit: 72 });
    const res = await client.get(url, OTODOM_HTML_HEADERS);
    const data = extractNextData(res.text) as { props: { pageProps: { data: { searchAds: { items: Record<string, unknown>[]; pagination: unknown } } } }; buildId: string } | null;
    if (res.status !== 200 || !data) {
      console.warn(`Otodom ${estate}: HTTP ${res.status} — fixture not updated`);
      continue;
    }
    const sa = data.props.pageProps.data.searchAds;
    const trimmed = {
      props: { pageProps: { data: { searchAds: { items: sa.items.slice(0, 6).map((i) => ({ ...i, images: undefined })), pagination: sa.pagination } } } },
      buildId: data.buildId,
    };
    writeFileSync(`tests/fixtures/otodom/${name}.json`, JSON.stringify(trimmed, null, 1));
    console.log(`Otodom ${estate}: saved ${trimmed.props.pageProps.data.searchAds.items.length} items`);
    await sleep(800);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
