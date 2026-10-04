import { describe, expect, it } from "vitest";
import { loadFixtureText } from "../../../tests/helpers/pglite-db";
import { extractTilesData, parseNoList, parsePolishDate } from "./parse-list";
import { buildNoListUrl } from "./search-url";

describe("nieruchomosci-online", () => {
  it("builds the positional search query", () => {
    expect(buildNoListUrl({ kind: "plot", location: "Wieliczka:32080", radiusKm: 15, page: 1 })).toBe("https://www.nieruchomosci-online.pl/szukaj.html?3,dzialka,sprzedaz,,Wieliczka:32080,,,15");
    expect(buildNoListUrl({ kind: "house", location: "Świątniki Górne", radiusKm: 0, page: 3 })).toBe("https://www.nieruchomosci-online.pl/szukaj.html?3,dom,sprzedaz,,%C5%9Awi%C4%85tniki%20G%C3%B3rne&p=3");
  });

  it("parses Polish long dates", () => {
    expect(parsePolishDate("30 września 2026")?.toISOString()).toBe("2026-09-29T22:00:00.000Z");
    expect(parsePolishDate("1 stycznia 2026")?.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(parsePolishDate("wczoraj")).toBeNull();
  });

  it("parses plot tiles with coordinates, areas from JSON-LD and seller type", () => {
    const html = loadFixtureText("nieruchomosci-online/list-plots.html");
    expect(Object.keys(extractTilesData(html)!).length).toBeGreaterThanOrEqual(5);
    const page = parseNoList(html, "plot");
    expect(page.total).toBe(1295);
    expect(page.totalPages).toBe(32);
    expect(page.parseErrors).toBe(0);
    const first = page.items[0]!;
    expect(first).toMatchObject({ source: "nieruchomosci_online", sourceId: "26954915", kind: "plot", price: 2_329_080, areaM2: 19_409, city: "Kokotów", locationPrecision: "approx", isPrivate: false });
    expect(first.url).toBe("https://kokotow.nieruchomosci-online.pl/dzialka,na-sprzedaz/26954915.html");
    expect(first.lat).toBeCloseTo(50.0202, 3);
    expect(first.lon).toBeCloseTo(20.1043, 3);
    expect(first.pricePerM2).toBe(120);
    expect(first.sourceCreatedAt).toBeInstanceOf(Date);
    expect(page.items.some((i) => i.plotType !== null)).toBe(true);
  });

  it("parses house tiles incl. plot area and rooms from the attributes", () => {
    const page = parseNoList(loadFixtureText("nieruchomosci-online/list-houses.html"), "house");
    const first = page.items[0]!;
    expect(first.kind).toBe("house");
    expect(first).toMatchObject({ sourceId: "26812795", price: 849_000, areaM2: 82.75, plotAreaM2: 147, rooms: 4, city: "Węgrzce Wielkie" });
  });

  it("recognises the empty page past the end of the results", () => {
    const page = parseNoList(loadFixtureText("nieruchomosci-online/list-end.html"), "plot");
    expect(page.items).toHaveLength(0);
  });
});
