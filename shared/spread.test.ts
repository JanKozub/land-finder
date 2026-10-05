import { describe, expect, it } from "vitest";
import { splitOverlapping, spreadOffset, spreadOverlapping, type PixelProjector } from "./spread";

/** 1 px = 0.001° in both axes; good enough to check the geometry. */
const projector: PixelProjector = {
  latLngToLayerPoint: ([lat, lon]) => ({ x: lon * 1000, y: -lat * 1000 }),
  layerPointToLatLng: ([x, y]) => ({ lat: -y / 1000, lng: x / 1000 }),
};

describe("spreading overlapping dots", () => {
  it("leaves lone dots alone and spreads identical coordinates on a ring with legs", () => {
    const items = [
      { id: 1, lat: 49.99, lon: 20.06 },
      { id: 2, lat: 49.99, lon: 20.06 },
      { id: 3, lat: 49.99004, lon: 20.06003 }, // within ~11 m: same group
      { id: 4, lat: 49.95, lon: 20.1 },
      { id: 5, lat: null, lon: null },
    ];
    const spread = spreadOverlapping(projector, items);
    expect(spread.positions.has(4)).toBe(false);
    expect(spread.positions.has(5)).toBe(false);
    expect(spread.positions.size).toBe(3);
    expect(spread.legs).toHaveLength(1);
    expect(spread.legs[0]).toHaveLength(3);
    for (const id of [1, 2, 3]) {
      const [lat, lon] = spread.positions.get(id)!;
      const px = Math.hypot((lon - 20.06) * 1000, (lat - 49.99) * 1000);
      expect(px).toBeCloseTo(14, 5);
    }
    const [a, b] = [spread.positions.get(1)!, spread.positions.get(2)!];
    expect(Math.hypot((a[1] - b[1]) * 1000, (a[0] - b[0]) * 1000)).toBeGreaterThan(12);
  });

  it("separates lone dots from the ones that share a spot", () => {
    const items = [
      { id: 1, lat: 49.99, lon: 20.06 },
      { id: 2, lat: 49.99004, lon: 20.06003 },
      { id: 3, lat: 49.95, lon: 20.1 },
      { id: 4, lat: null, lon: null },
    ];
    const { solo, grouped } = splitOverlapping(items);
    expect(solo.map((i) => i.id)).toEqual([3]);
    expect(grouped.map((i) => i.id).sort()).toEqual([1, 2]);
    expect(spreadOverlapping(projector, grouped).positions.size).toBe(2);
  });

  it("switches to a sunflower for big groups and keeps neighbours apart", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: i, lat: 50, lon: 20 }));
    const spread = spreadOverlapping(projector, items);
    const points = [...spread.positions.values()].map(([lat, lon]): [number, number] => [lon * 1000, -lat * 1000]);
    let minDist = Infinity;
    for (const [i, a] of points.entries()) for (const b of points.slice(i + 1)) minDist = Math.min(minDist, Math.hypot(a[0] - b[0], a[1] - b[1]));
    expect(minDist).toBeGreaterThan(10);
    expect(Math.hypot(...spreadOffset(39, 40))).toBeLessThan(60);
  });
});
