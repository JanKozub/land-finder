import { z } from "zod";
import { haversineKm } from "./geo";
import type { Settings } from "./schemas";

/** Search area as a geographic rectangle (degrees). */
export const AreaSchema = z
  .object({
    south: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
  })
  .refine((a) => a.north > a.south && a.east > a.west, "Prostokąt obszaru ma zerową szerokość lub wysokość")
  .refine((a) => a.north - a.south <= 1.5 && a.east - a.west <= 2.5, "Obszar jest za duży (maks. ok. 160 km)");
export type Area = z.infer<typeof AreaSchema>;

const KM_PER_DEG_LAT = 111.32;

export function areaCenter(a: Area): { lat: number; lon: number } {
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  return { lat: r((a.south + a.north) / 2), lon: r((a.west + a.east) / 2) };
}

/** Radius (km, whole number) of the circle around the centre that covers the whole rectangle. */
export function areaCoveringRadiusKm(a: Area): number {
  const c = areaCenter(a);
  return Math.max(1, Math.ceil(haversineKm(c.lat, c.lon, a.north, a.east)));
}

/** Width × height of the rectangle in km. */
export function areaSizeKm(a: Area): { widthKm: number; heightKm: number } {
  const c = areaCenter(a);
  return { widthKm: haversineKm(c.lat, a.west, c.lat, a.east), heightKm: haversineKm(a.south, c.lon, a.north, c.lon) };
}

/** Square of ±radiusKm around a point. */
export function areaFromCenter(lat: number, lon: number, radiusKm: number): Area {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon = radiusKm / (KM_PER_DEG_LAT * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  return { south: r(lat - dLat), west: r(lon - dLon), north: r(lat + dLat), east: r(lon + dLon) };
}

export function areaExpand(a: Area, km: number): Area {
  const c = areaCenter(a);
  const dLat = km / KM_PER_DEG_LAT;
  const dLon = km / (KM_PER_DEG_LAT * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180)));
  return { south: a.south - dLat, west: a.west - dLon, north: a.north + dLat, east: a.east + dLon };
}

/** Is the point inside the rectangle, allowing `marginKm` of slack (approximate coordinates, pins on the border)? */
export function areaContains(a: Area, lat: number, lon: number, marginKm = 0): boolean {
  const box = marginKm > 0 ? areaExpand(a, marginKm) : a;
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

export type LatLon = [number, number];

export interface GminaRecord {
  /** TERYT TERC code; the first four digits identify the powiat. */
  terc: string;
  name: string;
  /** 1 = miejska (town), 2 = wiejska (rural), 3 = miejsko-wiejska (urban-rural). */
  type: 1 | 2 | 3;
  powiat: string;
  powiatTerc: string;
  centroid: LatLon;
  bbox: Area;
  rings: LatLon[][];
}

function pointInRing(lat: number, lon: number, ring: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]!;
    const [yj, xj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(p1: LatLon, p2: LatLon, p3: LatLon, p4: LatLon): boolean {
  const d = (a: LatLon, b: LatLon, c: LatLon) => (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Does the polygon ring overlap the rectangle (shares area, not just a bounding-box touch)? */
export function ringIntersectsArea(ring: LatLon[], a: Area): boolean {
  if (ring.some(([lat, lon]) => areaContains(a, lat, lon))) return true;
  const corners: LatLon[] = [
    [a.south, a.west],
    [a.south, a.east],
    [a.north, a.east],
    [a.north, a.west],
  ];
  if (corners.some(([lat, lon]) => pointInRing(lat, lon, ring))) return true;
  for (let i = 0; i < ring.length - 1; i++) {
    for (let j = 0; j < 4; j++) {
      if (segmentsIntersect(ring[i]!, ring[i + 1]!, corners[j]!, corners[(j + 1) % 4]!)) return true;
    }
  }
  return false;
}

export function gminaIntersectsArea(g: GminaRecord, a: Area): boolean {
  const b = g.bbox;
  if (b.north < a.south || b.south > a.north || b.east < a.west || b.west > a.east) return false;
  return g.rings.some((ring) => ringIntersectsArea(ring, a));
}

export function gminasInArea(gminas: readonly GminaRecord[], a: Area): GminaRecord[] {
  return gminas.filter((g) => gminaIntersectsArea(g, a)).sort((x, y) => x.name.localeCompare(y.name, "pl"));
}

/** "Świątniki Górne" → "swiatniki-gorne". */
export function slugifyPl(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isCityPowiat(g: GminaRecord): boolean {
  return g.type === 1 && slugifyPl(g.name) === slugifyPl(g.powiat);
}

/** Gratka: `gmina-<slug>` for rural/urban-rural gminas, `<slug>` for towns. */
export function gratkaLocationFor(g: GminaRecord): string {
  return g.type === 1 ? slugifyPl(g.name) : `gmina-${slugifyPl(g.name)}`;
}

/** Adresowo uses the same convention as Gratka for administrative pages. */
export function adresowoLocationFor(g: GminaRecord): string {
  return gratkaLocationFor(g);
}

/** Morizon: `<powiat>/gmina-<slug>`, towns `<powiat>/miasto-<slug>`, city counties just `<slug>`. */
export function morizonLocationFor(g: GminaRecord): string {
  if (isCityPowiat(g)) return slugifyPl(g.name);
  const powiat = slugifyPl(g.powiat);
  return g.type === 1 ? `${powiat}/miasto-${slugifyPl(g.name)}` : `${powiat}/gmina-${slugifyPl(g.name)}`;
}

export interface DerivedPortalSettings {
  radiusKm: number;
  gratka: string;
  morizon: string;
  adresowo: string;
}

/** What the per-portal settings should be for an area and the gminas chosen inside it. */
export function derivePortalSettings(area: Area, gminas: readonly GminaRecord[]): DerivedPortalSettings {
  return {
    radiusKm: areaCoveringRadiusKm(area),
    gratka: gminas.map(gratkaLocationFor).join(", "),
    morizon: gminas.map(morizonLocationFor).join(", "),
    adresowo: gminas.map(adresowoLocationFor).join(", "),
  };
}

/** The gmina containing the point, falling back to the nearest centroid. */
export function gminaAt(gminas: readonly GminaRecord[], lat: number, lon: number): GminaRecord | null {
  const containing = gminas.find((g) => areaContains(g.bbox, lat, lon) && g.rings.some((ring) => pointInRing(lat, lon, ring)));
  if (containing) return containing;
  let best: GminaRecord | null = null;
  let bestKm = Infinity;
  for (const g of gminas) {
    const km = haversineKm(lat, lon, g.centroid[0], g.centroid[1]);
    if (km < bestKm) {
      bestKm = km;
      best = g;
    }
  }
  return best;
}

const VOIVODESHIPS: Record<string, string> = {
  "02": "dolnoslaskie", "04": "kujawsko-pomorskie", "06": "lubelskie", "08": "lubuskie", "10": "lodzkie", "12": "malopolskie",
  "14": "mazowieckie", "16": "opolskie", "18": "podkarpackie", "20": "podlaskie", "22": "pomorskie", "24": "slaskie",
  "26": "swietokrzyskie", "28": "warminsko-mazurskie", "30": "wielkopolskie", "32": "zachodniopomorskie",
};

export function voivodeshipSlug(terc: string): string {
  return VOIVODESHIPS[terc.slice(0, 2)] ?? "malopolskie";
}

/** Otodom location path `<voivodeship>/<powiat>/<gmina>`; city counties repeat the city (`malopolskie/krakow/krakow`). */
export function otodomPathFor(g: GminaRecord): string {
  const powiat = isCityPowiat(g) ? slugifyPl(g.name) : slugifyPl(g.powiat);
  return `${voivodeshipSlug(g.terc)}/${powiat}/${slugifyPl(g.name)}`;
}

/** Domiporta searches by town: `<voivodeship>/<town>`. */
export function domiportaLocationFor(g: GminaRecord): string {
  return `${voivodeshipSlug(g.terc)}/${slugifyPl(g.name)}`;
}

/** Nieruchomosci-online searches by locality name (the portal's own id is optional). */
export function noLocationFor(g: GminaRecord): string {
  return g.name;
}

/**
 * Rewrites every portal's location/radius from the rectangle: the covering circle around the centre gmina for portals
 * with radius search, the gminas inside the rectangle for the others. Enabled flags and the OLX city id are kept
 * (the id is resolved separately because it needs the portal). Returns null when the dataset does not cover the area.
 */
export function deriveSettingsFromArea(settings: Settings, gminas: readonly GminaRecord[]): Settings | null {
  const center = areaCenter(settings.area);
  const home = gminaAt(gminas, center.lat, center.lon);
  if (!home) return null;
  const chosen = gminasInArea(gminas, settings.area).filter((g) => !settings.excludedGminy.includes(g.terc));
  const radius = Math.min(100, areaCoveringRadiusKm(settings.area));
  const lists = derivePortalSettings(settings.area, chosen.length ? chosen : [home]);
  return {
    ...settings,
    center,
    radiusKm: radius,
    olx: { ...settings.olx, cityName: home.name, distanceKm: radius },
    otodom: { ...settings.otodom, locationPath: otodomPathFor(home), radiusKm: radius },
    nieruchomosci_online: { ...settings.nieruchomosci_online, location: noLocationFor(home), radiusKm: radius },
    domiporta: { ...settings.domiporta, location: domiportaLocationFor(home), radiusKm: radius },
    gratka: { ...settings.gratka, location: lists.gratka, radiusKm: 0 },
    morizon: { ...settings.morizon, location: lists.morizon, radiusKm: 0 },
    adresowo: { ...settings.adresowo, location: lists.adresowo, radiusKm: 0 },
  };
}
