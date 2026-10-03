import { describe, expect, it } from "vitest";
import { loadFixture } from "../../../tests/helpers/pglite-db";
import { parseOtodomAd } from "./parse-ad";

describe("Otodom ad parser", () => {
  it("reads coordinates, precision, status and structured attributes", () => {
    const ad = parseOtodomAd(loadFixture("otodom/ad-detail.json"))!;
    expect(ad).not.toBeNull();
    expect(ad.lat).toBeCloseTo(49.98777, 5);
    expect(ad.lon).toBeCloseTo(19.67953, 5);
    expect(ad.locationPrecision).toBe("exact");
    expect(ad.locationRadiusKm).toBe(0);
    expect(ad.status).toBe("active");
    expect(ad.areaM2).toBe(330);
    expect(ad.plotAreaM2).toBe(1000);
    expect(ad.attributes).toMatchObject({ Build_year: "1980", MarketType: "secondary" });
  });

  it("returns null without an ad node", () => {
    expect(parseOtodomAd({ pageProps: {} })).toBeNull();
    expect(parseOtodomAd(null)).toBeNull();
  });
});
