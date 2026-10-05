import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AreaSchema,
  adresowoLocationFor,
  areaCenter,
  areaContains,
  areaCoveringRadiusKm,
  areaFromCenter,
  derivePortalSettings,
  gminasInArea,
  gratkaLocationFor,
  morizonLocationFor,
  ringIntersectsArea,
  slugifyPl,
  type GminaRecord,
} from "./area";

const wieliczka = areaFromCenter(49.9873, 20.0646, 15);

describe("search area", () => {
  it("builds a square around a point and derives centre and covering radius", () => {
    expect(wieliczka.north - wieliczka.south).toBeCloseTo(0.2695, 3);
    expect(areaCenter(wieliczka)).toEqual({ lat: 49.9873, lon: 20.0646 });
    expect(areaCoveringRadiusKm(wieliczka)).toBe(22); // half diagonal of a 30 km square
    expect(AreaSchema.safeParse(wieliczka).success).toBe(true);
    expect(AreaSchema.safeParse({ ...wieliczka, north: wieliczka.south }).success).toBe(false);
    expect(AreaSchema.safeParse({ south: 49, west: 19, north: 51, east: 22 }).success).toBe(false);
  });

  it("tests containment with a margin", () => {
    expect(areaContains(wieliczka, 49.9873, 20.0646)).toBe(true);
    expect(areaContains(wieliczka, 50.13, 20.0646)).toBe(false);
    expect(areaContains(wieliczka, 50.13, 20.0646, 1)).toBe(true);
  });

  it("detects rectangle/polygon overlap incl. a polygon that surrounds the rectangle", () => {
    const ring: [number, number][] = [
      [49.9, 20.0],
      [49.9, 20.1],
      [50.0, 20.1],
      [50.0, 20.0],
      [49.9, 20.0],
    ];
    expect(ringIntersectsArea(ring, { south: 49.95, west: 20.05, north: 49.97, east: 20.07 })).toBe(true); // rect inside polygon
    expect(ringIntersectsArea(ring, { south: 49.8, west: 19.9, north: 50.1, east: 20.2 })).toBe(true); // polygon inside rect
    expect(ringIntersectsArea(ring, { south: 49.95, west: 20.05, north: 50.05, east: 20.2 })).toBe(true); // crossing
    expect(ringIntersectsArea(ring, { south: 50.05, west: 20.2, north: 50.1, east: 20.3 })).toBe(false);
  });

  it("maps gminas to each portal's URL grammar", () => {
    const rural: GminaRecord = { terc: "1219012", name: "Biskupice", type: 2, powiat: "wielicki", powiatTerc: "1219", centroid: [49.9, 20.15], bbox: { south: 49.85, west: 20.1, north: 49.95, east: 20.2 }, rings: [] };
    const urbanRural: GminaRecord = { ...rural, terc: "1219053", name: "Wieliczka", type: 3 };
    const city: GminaRecord = { ...rural, terc: "1261011", name: "Kraków", type: 1, powiat: "Kraków", powiatTerc: "1261" };
    const town: GminaRecord = { ...rural, terc: "1201011", name: "Bochnia", type: 1, powiat: "bocheński", powiatTerc: "1201" };
    const swiatniki: GminaRecord = { ...rural, terc: "1206152", name: "Świątniki Górne", type: 3, powiat: "krakowski", powiatTerc: "1206" };
    expect(slugifyPl("Świątniki Górne")).toBe("swiatniki-gorne");
    expect(gratkaLocationFor(rural)).toBe("gmina-biskupice");
    expect(gratkaLocationFor(urbanRural)).toBe("gmina-wieliczka");
    expect(gratkaLocationFor(city)).toBe("krakow");
    expect(adresowoLocationFor(swiatniki)).toBe("gmina-swiatniki-gorne");
    expect(morizonLocationFor(rural)).toBe("wielicki/gmina-biskupice");
    expect(morizonLocationFor(town)).toBe("bochenski/miasto-bochnia");
    expect(morizonLocationFor(city)).toBe("krakow");
    const derived = derivePortalSettings(wieliczka, [urbanRural, city]);
    expect(derived).toEqual({ radiusKm: 22, gratka: "gmina-wieliczka, krakow", morizon: "wielicki/gmina-wieliczka, krakow", adresowo: "gmina-wieliczka, krakow" });
  });

  it("derives the centre gmina and every portal's query from the rectangle", async () => {
    const { GMINY } = await import("./area-data");
    const { DEFAULT_SETTINGS } = await import("./schemas");
    const derived = (await import("./area")).deriveSettingsFromArea({ ...DEFAULT_SETTINGS, excludedGminy: ["1261011"] }, GMINY)!;
    expect(derived.otodom.locationPath).toBe("malopolskie/wielicki/wieliczka");
    expect(derived.olx.cityName).toBe("Wieliczka");
    expect(derived.olx.distanceKm).toBe(22);
    expect(derived.otodom.radiusKm).toBe(25); // Otodom only paginates reliably on its own radius values
    expect(derived.domiporta).toMatchObject({ location: "malopolskie/wieliczka", radiusKm: 22 });
    expect(derived.nieruchomosci_online).toMatchObject({ location: "Wieliczka", radiusKm: 22 });
    expect(derived.gratka.location).not.toContain("krakow"); // excluded by TERC
    expect(derived.gratka.location.split(", ")).toContain("gmina-swiatniki-gorne");
    expect(derived.morizon.location.split(", ")).toContain("krakowski/gmina-mogilany");
    expect(derived.adresowo.location.split(", ")).toContain("gmina-niepolomice");
  });

  it("snaps Otodom radii up to the next supported value", async () => {
    const { snapOtodomRadius } = await import("./constants");
    expect([0, 5, 15, 19, 22, 26, 80].map(snapOtodomRadius)).toEqual([0, 5, 15, 25, 25, 50, 75]);
  });

  it("finds the gminas around Wieliczka in the bundled dataset", () => {
    const data = JSON.parse(readFileSync(new URL("./data/gminy.json", import.meta.url), "utf8")) as { gminy: GminaRecord[] };
    const names = gminasInArea(data.gminy, wieliczka).map((g) => g.name);
    for (const expected of ["Wieliczka", "Niepołomice", "Biskupice", "Gdów", "Kłaj", "Kraków", "Świątniki Górne", "Mogilany", "Siepraw", "Dobczyce", "Skawina"]) expect(names).toContain(expected);
    expect(names).not.toContain("Zakopane");
    expect(names.length).toBeLessThan(30);
  });
});
