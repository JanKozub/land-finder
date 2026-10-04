export type LatLon = [number, number];

/** The two projections the spread needs from a Leaflet map (kept abstract so the maths is testable without a DOM). */
export interface PixelProjector {
  latLngToLayerPoint(latlng: LatLon): { x: number; y: number };
  layerPointToLatLng(point: [number, number]): { lat: number; lng: number };
}

export interface Located {
  id: number;
  lat: number | null;
  lon: number | null;
}

export interface Spread {
  /** Display position per item id, only for items that share their coordinates with others. */
  positions: Map<number, LatLon>;
  /** One entry per group: segments from the real spot to each displayed dot. */
  legs: LatLon[][][];
}

/** Pixel offset of the i-th of n dots: a ring for small groups, Vogel's sunflower (≈16 px spacing) beyond nine. */
export function spreadOffset(i: number, n: number): [number, number] {
  if (n <= 9) {
    const radius = n <= 5 ? 14 : 18;
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  }
  const radius = 9 * Math.sqrt(i + 1);
  const angle = i * 2.399963;
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

/**
 * Offers that only name a town share its centroid, so their dots would sit on top of each other. Groups of
 * identical coordinates (to ~11 m) are spread in screen pixels, so they stay apart at every zoom level, with thin
 * legs pointing back to the real spot. Call again after a zoom change.
 */
export function spreadOverlapping(map: PixelProjector, items: readonly Located[]): Spread {
  const groups = new Map<string, Located[]>();
  for (const item of items) {
    if (item.lat === null || item.lon === null) continue;
    const key = `${item.lat.toFixed(4)},${item.lon.toFixed(4)}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const positions = new Map<number, LatLon>();
  const legs: LatLon[][][] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const first = group[0]!;
    const origin: LatLon = [first.lat!, first.lon!];
    const centre = map.latLngToLayerPoint(origin);
    const groupLegs: LatLon[][] = [];
    group.forEach((item, i) => {
      const [dx, dy] = spreadOffset(i, group.length);
      const ll = map.layerPointToLatLng([centre.x + dx, centre.y + dy]);
      const pos: LatLon = [ll.lat, ll.lng];
      positions.set(item.id, pos);
      groupLegs.push([origin, pos]);
    });
    legs.push(groupLegs);
  }
  return { positions, legs };
}
