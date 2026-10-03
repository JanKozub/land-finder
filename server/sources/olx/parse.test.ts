import { describe, expect, it } from "vitest";
import { loadFixture } from "../../../tests/helpers/pglite-db";
import { parseOlxOffer, parseOlxOffersResponse } from "./parse";

describe("OLX parser", () => {
  it("parses a plots page and rejects records without a link", () => {
    const page = parseOlxOffersResponse(loadFixture("olx/offers-plots-p1.json"), "plot");
    expect(page.total).toBe(331);
    expect(page.hasNextLink).toBe(true);
    expect(page.items).toHaveLength(2);
    expect(page.parseErrors).toBe(1);

    const [a, b] = page.items;
    expect(a).toMatchObject({
      source: "olx",
      sourceId: "1000000001",
      kind: "plot",
      price: 249_000,
      priceNegotiable: true,
      areaM2: 1200,
      plotAreaM2: null,
      pricePerM2: 207.5,
      plotType: "dzialki-budowlane",
      lat: 49.98971,
      lon: 20.06712,
      locationPrecision: "exact",
      locationRadiusKm: 0,
      city: "Wieliczka",
      region: "Małopolskie",
      isPrivate: true,
      advertiserName: "Anna",
      advertiserId: "12345",
    });
    expect(a!.url).toMatch(/^https:\/\/www\.olx\.pl\/d\/oferta\//);
    expect(a!.descriptionExcerpt).toBe("Na sprzedaż działka budowlana o powierzchni 1200 m² w Wieliczce. Media w drodze, dojazd asfaltowy.");
    expect(a!.sourceCreatedAt?.toISOString()).toBe("2026-10-01T16:40:11.000Z");
    expect(a!.sourceRefreshedAt?.toISOString()).toBe("2026-10-03T07:12:00.000Z");
    expect(a!.validTo?.toISOString()).toBe("2026-10-31T16:40:11.000Z");

    expect(b).toMatchObject({
      sourceId: "1000000002",
      price: null,
      priceNegotiable: false,
      areaM2: 3500,
      pricePerM2: null,
      plotType: "dzialki-rolne",
      locationPrecision: "approx",
      locationRadiusKm: 3,
      isPrivate: false,
      district: "Centrum",
    });
    expect(b!.attributes.arranged).toBe(true);
    expect(b!.attributes.partner).toBe("asari");
  });

  it("parses houses with living and plot area", () => {
    const page = parseOlxOffersResponse(loadFixture("olx/offers-houses-p1.json"), "house");
    expect(page.items).toHaveLength(1);
    expect(page.hasNextLink).toBe(false);
    expect(page.items[0]).toMatchObject({
      kind: "house",
      price: 719_000,
      areaM2: 110,
      plotAreaM2: 900,
      pricePerM2: 6536.36,
      plotType: null,
      city: "Słomniki",
    });
    expect(page.items[0]!.attributes).toMatchObject({ market: "Wtórny", builtType: "Wolnostojący", floors: "Jednopiętrowy", categoryId: 18 });
  });

  it("returns null for offers without essential fields", () => {
    expect(parseOlxOffer({ id: 1, title: "x", url: "nope" }, "plot")).toBeNull();
    expect(parseOlxOffer({ id: 1, url: "https://www.olx.pl/d/oferta/x.html" }, "plot")).toBeNull();
    expect(parseOlxOffer(null, "plot")).toBeNull();
  });

  it("throws on a malformed response", () => {
    expect(() => parseOlxOffersResponse({ error: "x" }, "plot")).toThrow(/no data array/);
  });
});
