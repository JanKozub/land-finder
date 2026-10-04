import { describe, expect, it } from "vitest";
import { extractNuxtData, nuxtDataByPrefix, unflattenDevalue } from "./nuxt";

describe("Nuxt devalue payload", () => {
  it("hydrates indices, typed tuples and special numbers", () => {
    // {data:{"property-listing-data-/x":{nodes:[{id:1,name:"a"},{id:2,name:"b"}],total:2}}, ref: Ref(42), empty: EmptyRef, nan: NaN}
    const flat: unknown[] = [
      { data: 1, ref: 8, empty: 10, nan: -3 }, // 0
      { "property-listing-data-/x": 2 }, // 1
      { nodes: 3, total: 7 }, // 2
      [4, 5], // 3
      { id: 6, name: 9 }, // 4
      { id: 7, name: 11 }, // 5
      1, // 6
      2, // 7
      ["Ref", 12], // 8
      "a", // 9
      ["EmptyRef", "[1,2]"], // 10
      "b", // 11
      42, // 12
    ];
    const data = unflattenDevalue(flat) as { data: Record<string, { nodes: { id: number; name: string }[]; total: number }>; ref: number; empty: number[]; nan: number };
    expect(data.data["property-listing-data-/x"]!.nodes).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
    expect(data.data["property-listing-data-/x"]!.total).toBe(2);
    expect(data.ref).toBe(42);
    expect(data.empty).toEqual([1, 2]);
    expect(Number.isNaN(data.nan)).toBe(true);
    expect(nuxtDataByPrefix(data, "property-listing-data-")).toEqual(data.data["property-listing-data-/x"]);
    expect(nuxtDataByPrefix(data, "missing-")).toBeNull();
  });

  it("extracts the payload from the page script and tolerates its absence", () => {
    const html = `<html><body><script type="application/json" id="__NUXT_DATA__" data-ssr="true">[{"a":1},"x"]</script></body></html>`;
    expect(extractNuxtData(html)).toEqual({ a: "x" });
    expect(extractNuxtData("<html></html>")).toBeNull();
    expect(extractNuxtData(`<script id="__NUXT_DATA__">{broken</script>`)).toBeNull();
  });
});
