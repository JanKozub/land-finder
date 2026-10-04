import { describe, expect, it } from "vitest";
import { loadFixtureText } from "../../../tests/helpers/pglite-db";
import { parseAdresowoAd, parseRelativeDays } from "./parse-ad";
import { parseAdresowoList } from "./parse-list";
import { buildAdresowoListUrl } from "./search-url";

describe("Adresowo", () => {
  it("builds list URLs for administrative slugs and radius searches", () => {
    expect(buildAdresowoListUrl({ kind: "plot", location: "powiat-wielicki", radiusKm: 0 })).toBe("https://adresowo.pl/dzialki/powiat-wielicki/");
    expect(buildAdresowoListUrl({ kind: "house", location: "wieliczka-1", radiusKm: 20 })).toBe("https://adresowo.pl/f/domy/wieliczka-1/g20");
  });

  it("parses plot cards: ids, prices, areas, seller type and the next link", () => {
    const page = parseAdresowoList(loadFixtureText("adresowo/list-plots.html"), "plot");
    expect(page.total).toBe(198);
    expect(page.resolvedLocation).toBe("wielicki");
    expect(page.nextUrl).toBe("https://adresowo.pl/dzialki/powiat-wielicki/_l2");
    expect(page.parseErrors).toBe(0);
    const first = page.items[0]!;
    expect(first).toMatchObject({ source: "adresowo", sourceId: "4285734", kind: "plot", price: 150_000, areaM2: 363, city: "Winiary", isPrivate: true, rooms: null });
    expect(first.url).toBe("https://adresowo.pl/o/dzialka-budowlana-gdow-winiary-winiary-s8k2s7");
    expect(first.title).toBe("Działka budowlana Winiary, Winiary");
    expect(first.pricePerM2).toBeCloseTo(413.22, 1);
    expect(first.attributes.publicCode).toBe("s8k2s7");
    expect(page.items.every((i) => i.isPrivate !== null)).toBe(true);
  });

  it("parses house cards with rooms", () => {
    const page = parseAdresowoList(loadFixtureText("adresowo/list-houses.html"), "house");
    const first = page.items[0]!;
    expect(first.kind).toBe("house");
    expect(first).toMatchObject({ price: 1_690_000, areaM2: 210, rooms: 4, city: "Jankówka", isPrivate: true });
  });

  it("flags an unrecognised location (empty /f/ view)", () => {
    const page = parseAdresowoList(loadFixtureText("adresowo/list-empty.html"), "plot");
    expect(page.items).toHaveLength(0);
    expect(page.resolvedLocation).toBeNull();
  });

  it("reads approximate coordinates, parameters and the relative date from the ad page", () => {
    const ad = parseAdresowoAd(loadFixtureText("adresowo/ad-plot.html"))!;
    expect(ad).toMatchObject({ lat: 49.894668, lon: 20.141801, radiusM: 1000, city: "Winiary", gmina: "Gdów", powiat: "wielicki", region: "małopolskie", isPrivate: true, addedDaysAgo: 1, priceNegotiable: true });
    expect(ad.params["Numer ewidencyjny działki"]).toBe("493/3");
    const house = parseAdresowoAd(loadFixtureText("adresowo/ad-house.html"))!;
    expect(house).toMatchObject({ plotAreaM2: 1100, addedDaysAgo: 3, city: "Jankówka" });
    expect(parseAdresowoAd("<html></html>")).toBeNull();
  });

  it("parses relative Polish dates", () => {
    expect(parseRelativeDays("dodana dzisiaj")).toBe(0);
    expect(parseRelativeDays("dodana wczoraj")).toBe(1);
    expect(parseRelativeDays("dodana 3 dni temu")).toBe(3);
    expect(parseRelativeDays("dodana 2 tygodnie temu")).toBe(14);
    expect(parseRelativeDays("coś innego")).toBeNull();
  });
});
