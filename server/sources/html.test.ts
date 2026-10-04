import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, extractJsonLd, jsonLdNodes, numberIn, splitLocations } from "./html";

describe("html helpers", () => {
  it("decodes numeric and named entities and normalises special spaces", () => {
    expect(decodeHtmlEntities("2&#xA0;200&#xA0;000 z&#x142; &amp; 724&nbsp;m&sup2; &#8211;")).toBe("2 200 000 zł & 724 m² –");
  });

  it("extracts numbers with Polish separators", () => {
    expect(numberIn("150&nbsp;000 zł")).toBe(150_000);
    expect(numberIn("0,0310 ha")).toBe(0.031);
    expect(numberIn("brak")).toBeNull();
  });

  it("reads every JSON-LD block and flattens @graph", () => {
    const html = `<script type="application/ld+json">{"@type":"A"}</script><script type="application/ld+json">{"@graph":[{"@type":"B"},{"@type":["C","D"]}]}</script><script type="application/ld+json">not json</script>`;
    expect(extractJsonLd(html)).toHaveLength(2);
    expect(jsonLdNodes(html).map((n) => n["@type"])).toEqual(["A", undefined, "B", ["C", "D"]]);
  });

  it("splits comma-separated locations", () => {
    expect(splitLocations(" powiat-wielicki, gmina-swiatniki-gorne ,/krakow/ ")).toEqual(["powiat-wielicki", "gmina-swiatniki-gorne", "krakow"]);
    expect(splitLocations("wielicki")).toEqual(["wielicki"]);
  });
});
