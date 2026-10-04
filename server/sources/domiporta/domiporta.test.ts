import { describe, expect, it } from "vitest";
import { loadFixtureText } from "../../../tests/helpers/pglite-db";
import { parseDomiportaAd } from "./parse-ad";
import { parseDomiportaList } from "./parse-list";
import { buildDomiportaListUrl } from "./search-url";

describe("Domiporta", () => {
  it("builds newest-first list URLs with the radius", () => {
    expect(buildDomiportaListUrl({ kind: "plot", location: "malopolskie/wieliczka", radiusKm: 15, page: 2 })).toBe(
      "https://www.domiporta.pl/dzialke/sprzedam/malopolskie/wieliczka?Distance=15&SortingOrderDirection=InsertionDateDescending&PageNumber=2",
    );
    expect(buildDomiportaListUrl({ kind: "house", location: "/malopolskie/wieliczka/", radiusKm: 0, page: 1 })).toContain("/dom/sprzedam/malopolskie/wieliczka?Distance=0");
  });

  it("parses plot cards joined with their JSON-LD items", () => {
    const page = parseDomiportaList(loadFixtureText("domiporta/list-plots.html"), "plot");
    expect(page.total).toBe(493);
    expect(page.totalPages).toBe(14);
    expect(page.hasNext).toBe(true);
    expect(page.parseErrors).toBe(0);
    expect(page.items.length).toBeGreaterThanOrEqual(5);
    const first = page.items[0]!;
    expect(first).toMatchObject({ source: "domiporta", sourceId: "156582693", kind: "plot", price: 2_200_000, areaM2: 724, city: "Kraków", isPrivate: false, locationPrecision: "unknown" });
    expect(first.url).toBe("https://www.domiporta.pl/nieruchomosci/sprzedam-dzialke-krakow-podgorze-duchackie-dobczycka-724m2/156582693");
    expect(first.title).toMatch(/^Działka 724 m² z domem/);
    expect(first.pricePerM2).toBeCloseTo(3038.67, 1);
    expect(first.advertiserName).toBe("DKB INVEST");
    expect(first.sourceCreatedAt?.toISOString().slice(0, 10)).toBe("2026-07-21"); // 2026-07-22 00:00 Warsaw = 21st 22:00 UTC
    expect(first.attributes.promoted).toBe(true);
  });

  it("parses house cards incl. the plot area given in hectares and rooms", () => {
    const page = parseDomiportaList(loadFixtureText("domiporta/list-houses.html"), "house");
    const first = page.items[0]!;
    expect(first.kind).toBe("house");
    expect(first).toMatchObject({ areaM2: 104, plotAreaM2: 310, rooms: 4, price: 970_000, city: "Rączna" });
    expect(page.items.every((i) => i.plotAreaM2 === null || i.plotAreaM2 >= 10)).toBe(true);
  });

  it("reads coordinates, plot type and advertiser type from the ad page", () => {
    const ad = parseDomiportaAd(loadFixtureText("domiporta/ad-plot.html"))!;
    expect(ad.lat).toBeCloseTo(49.98248, 4);
    expect(ad.lon).toBeCloseTo(20.05706, 4);
    expect(ad.plotType).toBe("budowlana");
    expect(ad.isPrivate).toBe(false);
    expect(ad.areaM2).toBe(1725);
    const house = parseDomiportaAd(loadFixtureText("domiporta/ad-house.html"))!;
    expect(house.lat).not.toBeNull();
    expect(parseDomiportaAd("<html><body>Brak ogłoszenia</body></html>")).toBeNull();
  });
});
