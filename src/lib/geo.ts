export { haversineKm } from "@shared/geo";

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function inBounds(lat: number | null, lon: number | null, b: Bounds | null): boolean {
  if (!b) return true;
  if (lat === null || lon === null) return false;
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}
