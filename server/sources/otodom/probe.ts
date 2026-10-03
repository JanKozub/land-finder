import type { FetchClient } from "../../http/fetch-client";
import { asNumber, asRecord } from "../parse-utils";
import { extractNextData, pagePropsOf } from "./parse-list";
import { OTODOM_HTML_HEADERS, buildOtodomListHtmlUrl } from "./search-url";

/** Returns `totalItems` for a search, or null when the page cannot be read (e.g. unknown location path). */
export async function probeOtodomTotal(
  client: FetchClient,
  p: { estate: string; locationPath: string; radiusKm: number },
): Promise<number | null> {
  const res = await client.get(buildOtodomListHtmlUrl({ ...p, page: 1, limit: 24 }), OTODOM_HTML_HEADERS);
  if (res.status !== 200) return null;
  const data = extractNextData(res.text);
  const pageProps = pagePropsOf(data);
  const searchAds = asRecord(asRecord(pageProps?.data)?.searchAds);
  const pagination = asRecord(searchAds?.pagination);
  return pagination ? asNumber(pagination.totalItems) : null;
}
