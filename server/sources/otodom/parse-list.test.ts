import { describe, expect, it } from "vitest";
import { loadFixture, loadFixtureText } from "../../../tests/helpers/pglite-db";
import { buildIdOf, extractNextData, parseOtodomSearch, parseRooms } from "./parse-list";

describe("Otodom list parser", () => {
  it("extracts __NEXT_DATA__ from HTML", () => {
    const data = extractNextData(loadFixtureText("otodom/search-page.html"));
    expect(data).not.toBeNull();
    expect(buildIdOf(data)).toBe("mGqk5wgHgzkZ129f54Sjh");
    expect(extractNextData("<html></html>")).toBeNull();
  });

  it("parses the HTML payload shape (plots)", () => {
    const page = parseOtodomSearch(loadFixture("otodom/search-dzialka-p1.json"), "plot");
    expect(page.total).toBe(1663);
    expect(page.totalPages).toBe(24);
    expect(page.buildId).toBe("mGqk5wgHgzkZ129f54Sjh");
    expect(page.items.length).toBeGreaterThanOrEqual(5);
    for (const item of page.items) {
      expect(item.url).toMatch(/^https:\/\/www\.otodom\.pl\/pl\/oferta\/[a-z0-9-]+-ID[A-Za-z0-9]+$/);
      expect(item.kind).toBe("plot");
      expect(item.locationPrecision).toBe("unknown");
      expect(item.lat).toBeNull();
      expect(item.sourceCreatedAt).toBeInstanceOf(Date);
    }
    const first = page.items[0]!;
    expect(first).toMatchObject({ sourceId: "68488582", price: 329_000, areaM2: 2071 });
    expect(first.pricePerM2).toBeCloseTo(158.86, 1);
    expect(first.city).toBeTruthy();
  });

  it("parses houses incl. plot area and rooms", () => {
    const page = parseOtodomSearch(loadFixture("otodom/search-dom-p1.json"), "house");
    const first = page.items[0]!;
    expect(first.kind).toBe("house");
    expect(first).toMatchObject({ areaM2: 330, plotAreaM2: 1000, rooms: 8, price: 1_149_000 });
    expect(first.isPrivate).toBe(false);
    expect(first.advertiserId).toMatch(/^agency:/);
  });

  it("parses the _next/data payload shape", () => {
    const page = parseOtodomSearch(loadFixture("otodom/nextdata-dzialka-p1.json"), "plot");
    expect(page.total).toBe(905);
    expect(page.totalPages).toBe(13);
    expect(page.items).toHaveLength(3);
    expect(page.buildId).toBeNull();
  });

  it("maps room words", () => {
    expect(parseRooms("EIGHT")).toBe(8);
    expect(parseRooms(3)).toBe(3);
    expect(parseRooms("MORE")).toBe(11);
    expect(parseRooms(null)).toBeNull();
  });
});
