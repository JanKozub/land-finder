import type { Feature, FeatureCollection, Geometry } from "geojson";

/**
 * Planned S7 expressway Kraków–Myślenice: six route variants (A–F) from GDDKiA's STEŚ study (2025).
 * Geometry files live in public/data/s7/<variant>.geojson (see scripts/fetch-s7-variants.ts).
 */
export const S7_VARIANTS = ["A", "B", "C", "D", "E", "F"] as const;
export type S7Variant = (typeof S7_VARIANTS)[number];

export const S7_KINDS = ["axis", "axisTunnel", "bdi", "bdiTunnel", "tunnel", "bridge", "interchange", "interchangeName", "extent", "km"] as const;
export type S7Kind = (typeof S7_KINDS)[number];

export interface S7FeatureProps {
  variant: S7Variant;
  kind: S7Kind;
  /** Interchange name or kilometre post label. */
  name?: string;
}
export type S7Feature = Feature<Geometry, S7FeatureProps>;
export type S7FeatureCollection = FeatureCollection<Geometry, S7FeatureProps>;

export function isS7Variant(value: string): value is S7Variant {
  return (S7_VARIANTS as readonly string[]).includes(value);
}

/** Road whose axis a distance refers to: the S7 itself or the BDI (Beskidzka Droga Integracyjna) branch in variants A–C. */
export type S7Road = "S7" | "BDI";

export interface S7Proximity {
  variant: S7Variant;
  road: S7Road;
  /** Distance from the property to the nearest point of the road axis, in metres. */
  meters: number;
}

/** Within this distance of the axis the land is in the roadway/embankment footprint. */
export const S7_ON_ROUTE_M = 150;
/** Within this distance the land is strongly affected (noise, access changes, possible expropriation of parts). */
export const S7_NEAR_M = 500;

export type S7Level = "on" | "near" | "far";

export function s7Level(meters: number): S7Level {
  if (meters <= S7_ON_ROUTE_M) return "on";
  if (meters <= S7_NEAR_M) return "near";
  return "far";
}

const ROAD_OF_KIND: Partial<Record<S7Kind, S7Road>> = { axis: "S7", axisTunnel: "S7", bdi: "BDI", bdiTunnel: "BDI" };

/** Metres per degree of latitude (and of longitude at the equator). */
const M_PER_DEG = 111_320;

interface IndexedLine {
  road: S7Road;
  xs: Float64Array;
  ys: Float64Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Road axes of one variant projected to a local planar frame (metres) for fast distance queries. */
export interface S7RouteIndex {
  variant: S7Variant;
  /** Reference latitude of the equirectangular projection. */
  lat0: number;
  kx: number;
  ky: number;
  lines: IndexedLine[];
}

/** Planar distance from point P to segment AB. */
export function pointToSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function axisParts(feature: S7Feature): number[][][] {
  const g = feature.geometry;
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
}

/**
 * Builds the distance index from the axis features (S7 and BDI, incl. tunnel sections) of one variant.
 * The equirectangular projection is accurate to well under 1 % over the ~30 km the routes span.
 */
export function buildS7RouteIndex(fc: S7FeatureCollection, variant: S7Variant): S7RouteIndex {
  const axes = fc.features.filter((f) => f.properties?.kind in ROAD_OF_KIND);
  let latSum = 0;
  let latCount = 0;
  for (const f of axes) for (const part of axisParts(f)) for (const c of part) {
    latSum += c[1]!;
    latCount++;
  }
  const lat0 = latCount ? latSum / latCount : 50;
  const ky = M_PER_DEG;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const lines: IndexedLine[] = [];
  for (const f of axes) {
    const road = ROAD_OF_KIND[f.properties.kind]!;
    for (const part of axisParts(f)) {
      if (part.length < 2) continue;
      const xs = new Float64Array(part.length);
      const ys = new Float64Array(part.length);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      part.forEach((c, i) => {
        const x = c[0]! * kx;
        const y = c[1]! * ky;
        xs[i] = x;
        ys[i] = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      });
      lines.push({ road, xs, ys, minX, minY, maxX, maxY });
    }
  }
  return { variant, lat0, kx, ky, lines };
}

/** Distance (m) from a point to the nearest axis of the variant, or null when the variant has no axis data. */
export function nearestOnS7Route(index: S7RouteIndex, lat: number, lon: number): { road: S7Road; meters: number } | null {
  const px = lon * index.kx;
  const py = lat * index.ky;
  let best = Infinity;
  let bestRoad: S7Road = "S7";
  for (const line of index.lines) {
    // Cheap lower bound: distance to the line's bounding box.
    const bx = px < line.minX ? line.minX - px : px > line.maxX ? px - line.maxX : 0;
    const by = py < line.minY ? line.minY - py : py > line.maxY ? py - line.maxY : 0;
    if (Math.hypot(bx, by) >= best) continue;
    for (let i = 1; i < line.xs.length; i++) {
      const d = pointToSegmentDistance(px, py, line.xs[i - 1]!, line.ys[i - 1]!, line.xs[i]!, line.ys[i]!);
      if (d < best) {
        best = d;
        bestRoad = line.road;
      }
    }
  }
  return best === Infinity ? null : { road: bestRoad, meters: best };
}

/** Distances to every indexed variant, nearest first. */
export function s7ProximityFor(indexes: readonly S7RouteIndex[], lat: number, lon: number): S7Proximity[] {
  const out: S7Proximity[] = [];
  for (const index of indexes) {
    const hit = nearestOnS7Route(index, lat, lon);
    if (hit) out.push({ variant: index.variant, road: hit.road, meters: hit.meters });
  }
  return out.sort((a, b) => a.meters - b.meters);
}
