import { describe, expect, it } from "vitest";
import { buildOtodomAdJsonUrl, buildOtodomListHtmlUrl, buildOtodomListJsonUrl, parseOtodomSearchUrl, slugFromOtodomUrl } from "./search-url";

describe("Otodom URLs", () => {
  it("parses a pasted search URL", () => {
    const parsed = parseOtodomSearchUrl("https://www.otodom.pl/pl/wyniki/sprzedaz/dzialka/malopolskie/wielicki/wieliczka/wieliczka?distanceRadius=15&limit=36&viewType=listing");
    expect(parsed).toEqual({ transaction: "sprzedaz", estate: "dzialka", locationPath: "malopolskie/wielicki/wieliczka/wieliczka", radiusKm: 15 });
    expect(parseOtodomSearchUrl("https://example.com/x")).toBeNull();
    expect(parseOtodomSearchUrl("not a url")).toBeNull();
  });

  it("builds list and ad URLs", () => {
    const p = { estate: "dzialka", locationPath: "malopolskie/wielicki/wieliczka", radiusKm: 15, page: 2, limit: 72 };
    expect(buildOtodomListHtmlUrl(p)).toBe(
      "https://www.otodom.pl/pl/wyniki/sprzedaz/dzialka/malopolskie/wielicki/wieliczka?distanceRadius=15&limit=72&page=2&by=LATEST&direction=DESC&viewType=listing",
    );
    const json = buildOtodomListJsonUrl("abc123", p);
    expect(json.startsWith("https://www.otodom.pl/_next/data/abc123/pl/wyniki/sprzedaz/dzialka/malopolskie/wielicki/wieliczka.json?")).toBe(true);
    expect(json).toContain("searchingCriteria=sprzedaz&searchingCriteria=dzialka&searchingCriteria=malopolskie&searchingCriteria=wielicki&searchingCriteria=wieliczka");
    expect(buildOtodomAdJsonUrl("abc123", "dom-ID4Dm")).toBe("https://www.otodom.pl/_next/data/abc123/pl/oferta/dom-ID4Dm.json?slug=dom-ID4Dm");
    expect(slugFromOtodomUrl("https://www.otodom.pl/pl/oferta/dom-ID4Dm")).toBe("dom-ID4Dm");
  });
});
