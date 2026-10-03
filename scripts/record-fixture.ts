import { mkdirSync, writeFileSync } from "node:fs";
import { OLX_CATEGORY } from "../shared/constants";
import { createFetchClient } from "../server/http/fetch-client";
import { OLX_JSON_HEADERS, buildOlxOffersUrl } from "../server/sources/olx/client";
import { extractNextData } from "../server/sources/otodom/parse-list";
import { OTODOM_HTML_HEADERS, buildOtodomListHtmlUrl } from "../server/sources/otodom/search-url";

/**
 * Records trimmed real responses as test fixtures (photos/descriptions removed).
 * Usage: pnpm fixtures:record   (needs network access to olx.pl / otodom.pl)
 */
async function main() {
  const client = createFetchClient();
  mkdirSync("tests/fixtures/olx", { recursive: true });
  mkdirSync("tests/fixtures/otodom", { recursive: true });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
