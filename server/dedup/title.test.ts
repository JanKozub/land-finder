import { describe, expect, it } from "vitest";
import { normalizeAdvertiser, normalizeTitle, tokenizeTitle } from "./normalize";
import { titleSimilarity } from "./title";

describe("title normalization", () => {
  it("strips diacritics, stopwords and short tokens", () => {
    expect(tokenizeTitle("Działka budowlana 12 ar, Wieliczka – media w drodze!")).toEqual(["wieliczka", "drodze"]);
    expect(normalizeTitle("Dom Dom dom Kraków Kraków")).toBe("krakow");
  });

  it("measures similarity and ignores uninformative titles", () => {
    const a = normalizeTitle("Działka budowlana 20,71 a - Jankówka, gm. Wieliczka");
    const b = normalizeTitle("Jankówka działka 2071 m2 gmina Wieliczka widok");
    expect(titleSimilarity(a, a)).toBe(1);
    expect(titleSimilarity(a, b)!).toBeGreaterThan(0.4);
    expect(titleSimilarity(a, normalizeTitle("Siedlisko nad jeziorem Mazury"))!).toBeLessThan(0.3);
    expect(titleSimilarity(normalizeTitle("Działka"), a)).toBeNull();
  });

  it("builds advertiser keys", () => {
    expect(normalizeAdvertiser("Biuro X", "agency:77")).toBe("agency:77");
    expect(normalizeAdvertiser("Osoba prywatna", null)).toBeNull();
    expect(normalizeAdvertiser("  Ewelina  Dumała ", null)).toBe("ewelina dumala");
  });
});
