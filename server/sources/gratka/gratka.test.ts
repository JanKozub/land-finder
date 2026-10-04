import { describe, expect, it } from "vitest";
import { loadFixture } from "../../../tests/helpers/pglite-db";
import { buildMorizonListUrl, morizonAdapter } from "../morizon/adapter";
import { buildGratkaListUrl, gratkaAdapter } from "./adapter";
import { parseMgAd, parseMgListing } from "./nuxt-listing";

describe("Gratka / Morizon (shared Nuxt payload)", () => {
  it("builds list URLs", () => {
    expect(buildGratkaListUrl({ kind: "plot", location: "powiat-wielicki", page: 1 })).toBe("https://gratka.pl/nieruchomosci/dzialki-grunty/powiat-wielicki");
    expect(buildGratkaListUrl({ kind: "house", location: "wieliczka", page: 3 })).toBe("https://gratka.pl/nieruchomosci/domy/wieliczka?page=3");
    expect(buildMorizonListUrl({ kind: "plot", location: "wielicki/miasto-wieliczka", page: 2 })).toBe("https://www.morizon.pl/dzialki/wielicki/miasto-wieliczka/?page=2");
    expect(gratkaAdapter.id).toBe("gratka");
    expect(morizonAdapter.id).toBe("morizon");
  });

  it("parses Gratka plot nodes from the powiat list", () => {
    const page = parseMgListing(loadFixture("gratka/list-plots.json"), "plot", "gratka", "https://gratka.pl");
    expect(page.total).toBe(416);
    expect(page.pageSize).toBe(35);
    expect(page.parseErrors).toBe(0);
    expect(page.items.length).toBeGreaterThanOrEqual(5);
    for (const item of page.items) {
      expect(item.url).toMatch(/^https:\/\/gratka\.pl\/nieruchomosci\/.+\/ob\/\d+$/);
      expect(item.sourceId).toMatch(/^\d+$/);
      expect(item.kind).toBe("plot");
      expect(item.locationPrecision).toBe("unknown");
    }
    const withAgency = page.items.find((i) => i.advertiserId?.startsWith("mg-agency:"));
    expect(withAgency?.isPrivate).toBe(false);
    expect(page.items.every((i) => i.city && i.region === "małopolskie")).toBe(true);
  });

  it("parses Gratka house nodes incl. rooms, dates and the internal id", () => {
    const page = parseMgListing(loadFixture("gratka/list-houses.json"), "house", "gratka", "https://gratka.pl");
    const first = page.items[0]!;
    expect(first).toMatchObject({ sourceId: "49162141", kind: "house", price: 1_600_000, areaM2: 282, rooms: 6, city: "Wieliczka" });
    expect(first.pricePerM2).toBeCloseTo(5673.76, 1);
    expect(first.attributes.internalId).toBe(1543093652);
    expect(first.sourceCreatedAt?.toISOString()).toBe("2026-10-01T22:00:00.000Z");
  });

  it("parses Morizon nodes with the same code (shared internal ids)", () => {
    const page = parseMgListing(loadFixture("morizon/list-plots.json"), "plot", "morizon", "https://www.morizon.pl");
    const first = page.items[0]!;
    expect(first.sourceId).toMatch(/^mzn\d+$/);
    expect(first.url).toMatch(/^https:\/\/www\.morizon\.pl\/oferta\//);
    expect(first.attributes.internalId).toBe(1543027761);
    expect(first.advertiserId).toBe("mg-agency:236681");
  });

  it("reads the ad page: approximate centre, plot type, plot area fixes and the added date", () => {
    const plot = parseMgAd(loadFixture("gratka/ad-plot.json"))!;
    expect(plot.active).toBe(true);
    expect(plot.lat).toBeCloseTo(49.98238, 4);
    expect(plot.lon).toBeCloseTo(20.06021, 4);
    expect(plot.plotType).toBe("budowlana");
    expect(plot.plotAreaM2).toBe(1005);
    expect(plot.hasStreet).toBe(false);
    expect(plot.addedAt?.toISOString()).toBe("2026-09-21T22:00:00.000Z");
    const house = parseMgAd(loadFixture("gratka/ad-house.json"))!;
    expect(house.hasStreet).toBe(true);
    expect(house.plotAreaM2).toBe(1500); // "0,15 m²" typed by the agent means 0.15 ha
    expect(parseMgAd({ data: {} })).toBeNull();
  });
});
