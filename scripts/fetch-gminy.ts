import { mkdirSync, writeFileSync } from "node:fs";

/**
 * Downloads gmina (admin_level 7) and powiat (admin_level 6) boundaries around Wieliczka from OpenStreetMap via
 * Overpass and writes a compact file with simplified polygons to shared/data/gminy.json.
 * Usage: pnpm gminy:fetch   (© OpenStreetMap contributors, ODbL)
 */
const BBOX = { south: 49.55, west: 19.4, north: 50.42, east: 20.75 };
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const TOLERANCE_DEG = 0.0015; // ~110–170 m, plenty for "does the rectangle touch this gmina"

type LatLon = [number, number];
interface OsmMember {
  type: string;
  role: string;
  geometry?: { lat: number; lon: number }[];
}
interface OsmRelation {
  type: "relation";
  id: number;
  tags: Record<string, string>;
  members: OsmMember[];
}

export interface GminaRecord {
  /** TERYT TERC code (7 digits); the first four identify the powiat. */
  terc: string;
  name: string;
  /** 1 = miejska (town), 2 = wiejska (rural), 3 = miejsko-wiejska (urban-rural). */
  type: 1 | 2 | 3;
  powiat: string;
  powiatTerc: string;
  centroid: LatLon;
  bbox: { south: number; west: number; north: number; east: number };
  /** Simplified outer rings as [lat, lon] pairs. */
  rings: LatLon[][];
}

async function overpass(query: string): Promise<{ elements: OsmRelation[] }> {
  let lastErr: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { method: "POST", body: `data=${encodeURIComponent(query)}`, headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "land-finder/1.0 (+https://github.com/JanKozub/land-finder)" } });
      if (!res.ok) throw new Error(`Overpass ${endpoint}: HTTP ${res.status}`);
      return (await res.json()) as { elements: OsmRelation[] };
    } catch (err) {
      lastErr = err;
      console.warn(String(err));
    }
  }
  throw lastErr;
}

/** Joins outer ways end-to-end into closed rings. */
function assembleRings(rel: OsmRelation): LatLon[][] {
  const ways = rel.members.filter((m) => m.type === "way" && (m.role === "outer" || m.role === "") && m.geometry?.length).map((m) => m.geometry!.map((p) => [p.lat, p.lon] as LatLon));
  const rings: LatLon[][] = [];
  const key = (p: LatLon) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const pending = [...ways];
  while (pending.length) {
    let ring = pending.shift()!;
    let extended = true;
    while (extended && key(ring[0]!) !== key(ring[ring.length - 1]!)) {
      extended = false;
      const end = key(ring[ring.length - 1]!);
      for (let i = 0; i < pending.length; i++) {
        const w = pending[i]!;
        if (key(w[0]!) === end) ring = ring.concat(w.slice(1));
        else if (key(w[w.length - 1]!) === end) ring = ring.concat([...w].reverse().slice(1));
        else continue;
        pending.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

function perpendicularDistance(p: LatLon, a: LatLon, b: LatLon): number {
  const dx = b[1] - a[1];
  const dy = b[0] - a[0];
  if (dx === 0 && dy === 0) return Math.hypot(p[1] - a[1], p[0] - a[0]);
  const t = Math.max(0, Math.min(1, ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[1] - (a[1] + t * dx), p[0] - (a[0] + t * dy));
}

/** Douglas–Peucker in degrees. */
function simplify(points: LatLon[], tolerance: number): LatLon[] {
  if (points.length < 3) return points;
  let maxDist = 0;
  let index = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= tolerance) return [first, last];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

function ringArea(ring: LatLon[]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) area += ring[i]![1] * ring[i + 1]![0] - ring[i + 1]![1] * ring[i]![0];
  return Math.abs(area) / 2;
}

function round(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

async function main() {
  const query = `[out:json][timeout:240];(rel["boundary"="administrative"]["admin_level"="7"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});rel["boundary"="administrative"]["admin_level"="6"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out geom;`;
  const data = await overpass(query);
  const powiats = new Map<string, string>();
  for (const rel of data.elements) {
    if (rel.tags?.admin_level === "6" && rel.tags["teryt:terc"]) powiats.set(rel.tags["teryt:terc"].slice(0, 4), rel.tags.name ?? "");
  }
  const out: GminaRecord[] = [];
  for (const rel of data.elements) {
    if (rel.tags?.admin_level !== "7") continue;
    const terc = rel.tags["teryt:terc"];
    const name = rel.tags.name;
    if (!terc || terc.length < 7 || !name) continue;
    const rings = assembleRings(rel)
      .map((r) => simplify(r, TOLERANCE_DEG).map(([lat, lon]) => [round(lat), round(lon)] as LatLon))
      .filter((r) => r.length >= 4)
      .sort((a, b) => ringArea(b) - ringArea(a))
      .slice(0, 3);
    if (!rings.length) continue;
    let south = 90, west = 180, north = -90, east = -180, latSum = 0, lonSum = 0, n = 0;
    for (const ring of rings) for (const [lat, lon] of ring) {
      south = Math.min(south, lat); north = Math.max(north, lat); west = Math.min(west, lon); east = Math.max(east, lon);
      latSum += lat; lonSum += lon; n++;
    }
    const typeDigit = Number(terc[6]);
    const type = typeDigit === 1 ? 1 : typeDigit === 2 ? 2 : 3;
    const powiatTerc = terc.slice(0, 4);
    out.push({
      terc,
      name: name.replace(/^gmina\s+/i, ""),
      type: type as 1 | 2 | 3,
      powiat: (powiats.get(powiatTerc) ?? "").replace(/^powiat\s+/i, ""),
      powiatTerc,
      centroid: [round(latSum / n), round(lonSum / n)],
      bbox: { south: round(south), west: round(west), north: round(north), east: round(east) },
      rings,
    });
  }
  out.sort((a, b) => a.terc.localeCompare(b.terc));
  mkdirSync("shared/data", { recursive: true });
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), attribution: "© OpenStreetMap contributors (ODbL)", gminy: out });
  writeFileSync("shared/data/gminy.json", body);
  console.log(`gminy: ${out.length}, powiaty: ${powiats.size}, ${Math.round(body.length / 1024)} KB`);
  console.log(out.filter((g) => g.powiat === "wielicki").map((g) => `${g.name} (${g.type}, ${g.terc})`).join("; "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
