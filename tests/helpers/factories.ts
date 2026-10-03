import type { Source } from "../../shared/constants";
import type { NormalizedListing } from "../../server/sources/types";

export function makeListing(o: Partial<NormalizedListing> & { source: Source; sourceId: string }): NormalizedListing {
  return {
    url: `https://www.${o.source}.pl/oferta/${o.sourceId}`,
    title: `Działka budowlana ${o.sourceId}`,
    kind: "plot",
    price: 200_000,
    priceNegotiable: false,
    areaM2: 1000,
    plotAreaM2: null,
    pricePerM2: 200,
    rooms: null,
    plotType: null,
    lat: 49.99,
    lon: 20.06,
    locationPrecision: "exact",
    locationRadiusKm: 0,
    city: "Wieliczka",
    district: null,
    region: "Małopolskie",
    isPrivate: true,
    advertiserName: "Jan",
    advertiserId: null,
    attributes: {},
    descriptionExcerpt: null,
    sourceCreatedAt: new Date("2026-10-01T10:00:00Z"),
    sourceRefreshedAt: new Date("2026-10-01T10:00:00Z"),
    validTo: null,
    ...o,
  };
}
