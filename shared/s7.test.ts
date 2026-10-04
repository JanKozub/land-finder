import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildS7RouteIndex,
  nearestOnS7Route,
  pointToSegmentDistance,
  s7Level,
  s7ProximityFor,
  type S7FeatureCollection,
} from "./s7";

const M_PER_DEG = 111_320;

function collection(features: Array<{ kind: string; coords: number[][]; variant?: string }>): S7FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      properties: { variant: (f.variant ?? "A") as "A", kind: f.kind as "axis" },
      geometry: { type: "LineString", coordinates: f.coords },
    })),
  };
}

describe("pointToSegmentDistance", () => {
  it("measures perpendicular distance inside the segment and endpoint distance outside it", () => {
    expect(pointToSegmentDistance(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
    expect(pointToSegmentDistance(14, 3, 0, 0, 10, 0)).toBeCloseTo(5);
    expect(pointToSegmentDistance(-4, 3, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  it("handles degenerate segments", () => {
    expect(pointToSegmentDistance(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });
});

describe("S7 route index", () => {
  // A north–south axis along 20.0° E between 49.9° N and 50.0° N.
  const fc = collection([
    { kind: "axis", coords: [[20.0, 49.9], [20.0, 49.95], [20.0, 50.0]] },
    { kind: "bdi", coords: [[20.1, 49.9], [20.1, 50.0]] },
  ]);
  const index = buildS7RouteIndex(fc, "A");

  it("measures the distance to the axis in metres", () => {
    const hit = nearestOnS7Route(index, 49.95, 20.001)!;
    const expected = 0.001 * M_PER_DEG * Math.cos((49.95 * Math.PI) / 180);
    expect(hit.road).toBe("S7");
    expect(hit.meters).toBeCloseTo(expected, 0);
  });

  it("measures the distance to the nearest endpoint beyond the end of the axis", () => {
    const hit = nearestOnS7Route(index, 50.001, 20.0)!;
    expect(hit.meters).toBeCloseTo(0.001 * M_PER_DEG, 0);
  });

  it("reports the BDI branch when it is the closest axis", () => {
    const hit = nearestOnS7Route(index, 49.95, 20.099)!;
    expect(hit.road).toBe("BDI");
    expect(hit.meters).toBeLessThan(100);
  });

  it("ignores non-axis features and returns null without axes", () => {
    const onlyPolygons = collection([{ kind: "extent", coords: [[20.0, 49.9], [20.0, 50.0]] }]);
    expect(buildS7RouteIndex(onlyPolygons, "B").lines).toHaveLength(0);
    expect(nearestOnS7Route(buildS7RouteIndex(onlyPolygons, "B"), 49.95, 20)).toBeNull();
  });

  it("sorts variants by distance", () => {
    const far = buildS7RouteIndex(collection([{ kind: "axis", coords: [[20.3, 49.9], [20.3, 50.0]], variant: "C" }]), "C");
    const prox = s7ProximityFor([far, index], 49.95, 20.001);
    expect(prox.map((p) => p.variant)).toEqual(["A", "C"]);
    expect(prox[1]!.meters).toBeGreaterThan(20_000);
  });
});

describe("s7Level", () => {
  it("classifies distances", () => {
    expect(s7Level(0)).toBe("on");
    expect(s7Level(150)).toBe("on");
    expect(s7Level(151)).toBe("near");
    expect(s7Level(500)).toBe("near");
    expect(s7Level(501)).toBe("far");
  });
});

describe("real GDDKiA data (variant A)", () => {
  const fc = JSON.parse(readFileSync(new URL("../public/data/s7/a.geojson", import.meta.url), "utf8")) as S7FeatureCollection;
  const index = buildS7RouteIndex(fc, "A");

  it("has S7 and BDI axes", () => {
    expect(index.lines.some((l) => l.road === "S7")).toBe(true);
    expect(index.lines.some((l) => l.road === "BDI")).toBe(true);
  });

  it("places every interchange label close to an axis", () => {
    const labels = fc.features.filter((f) => f.properties.kind === "interchangeName" && f.geometry.type === "Point");
    expect(labels.length).toBeGreaterThan(3);
    for (const label of labels) {
      const [lon, lat] = (label.geometry as GeoJSON.Point).coordinates as [number, number];
      expect(nearestOnS7Route(index, lat, lon)!.meters).toBeLessThan(600);
    }
  });

  it("keeps Wieliczka town centre several kilometres away from variant A", () => {
    expect(nearestOnS7Route(index, 49.9873, 20.0646)!.meters).toBeGreaterThan(5_000);
  });
});
