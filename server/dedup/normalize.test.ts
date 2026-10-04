import { describe, expect, it } from "vitest";
import { dedupKeysFor, sameSellerTokens, sellerTokens, withDedupKeys } from "./normalize";

describe("seller identity across portals", () => {
  it("keeps the distinctive words of an agency name", () => {
    expect(sellerTokens("BRACIA SADURSCY - ODDZIAŁ I")).toEqual(["bracia", "sadurscy"]);
    expect(sellerTokens("Bracia Sadurscy Oddział BS5 Nowa Huta")).toEqual(["bracia", "sadurscy", "bs5", "nowa", "huta"]);
    expect(sellerTokens("DĘBOSZ Nieruchomości")).toEqual(["debosz"]);
    expect(sellerTokens("N20 Nieruchomości s.c.")).toEqual(["n20"]);
    expect(sellerTokens("Osoba prywatna")).toEqual([]);
    expect(sellerTokens("Nieruchomości A-Z")).toEqual([]);
    expect(sellerTokens(null)).toEqual([]);
  });

  it("matches branches and legal-form variants of one agency, not unrelated names", () => {
    expect(sameSellerTokens(sellerTokens("BRACIA SADURSCY - ODDZIAŁ I"), sellerTokens("Bracia Sadurscy Nieruchomości"))).toBe(true);
    expect(sameSellerTokens(sellerTokens("homfi sp. z o.o."), sellerTokens("Homfi"))).toBe(true);
    expect(sameSellerTokens(sellerTokens("N20 NIERUCHOMOŚCI"), sellerTokens("N20 Nieruchomości s.c."))).toBe(true);
    expect(sameSellerTokens(sellerTokens("MB ESTATES"), sellerTokens("MB Nieruchomości Kraków"))).toBe(false); // "mb" alone is too weak
    expect(sameSellerTokens(sellerTokens("ESTATE ZINA"), sellerTokens("ESTATE ZINA JURIJ ZINIAK"))).toBe(true);
    expect(sameSellerTokens(sellerTokens("Kruczek Nieruchomości"), sellerTokens("DĘBOSZ Nieruchomości"))).toBe(false);
    expect(sameSellerTokens([], ["x"])).toBe(false);
  });
});

describe("advertisement identity keys", () => {
  it("derives keys from platform ids and distinctive agency references", () => {
    expect(dedupKeysFor({ internalId: 1543027761 })).toEqual(["mg:1543027761"]);
    expect(dedupKeysFor({ internalId: "1543027761", externalId: "44/8850/OGS" })).toEqual(["mg:1543027761", "ref:44/8850/ogs"]);
    expect(dedupKeysFor({ offerNumber: "BS5-DS-307955-42" })).toEqual(["ref:bs5-ds-307955-42"]);
    expect(dedupKeysFor({ externalId: "0011" })).toEqual([]);
    expect(dedupKeysFor({ externalId: "934935" })).toEqual(["ref:934935"]);
    expect(dedupKeysFor({ externalId: "1234" })).toEqual([]);
  });

  it("embeds keys into attributes and refreshes stale ones", () => {
    expect(withDedupKeys({ a: 1, dedupKeys: ["ref:old"] })).toEqual({ a: 1 });
    expect(withDedupKeys({ internalId: 5, dedupKeys: ["ref:old"] })).toEqual({ internalId: 5, dedupKeys: ["mg:5"] });
  });
});
