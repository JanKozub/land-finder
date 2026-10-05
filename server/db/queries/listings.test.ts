import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeListing } from "../../../tests/helpers/factories";
import { createTestDb } from "../../../tests/helpers/pglite-db";
import type { DbHandle } from "../client";
import { upsertListings } from "./listings";

let handle: DbHandle;
beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => handle.close());

describe("upsertListings", () => {
  it("refreshes a bumped listing without asking for dedup again, but does so when price or coordinates change", async () => {
    const { db } = handle;
    const t0 = new Date("2026-10-04T10:00:00Z");
    const base = makeListing({ source: "olx", sourceId: "U1", price: 100_000, sourceRefreshedAt: t0 });
    const [first] = await upsertListings(db, [base], t0);
    expect(first).toMatchObject({ inserted: true, needsAssignment: true });

    const t1 = new Date("2026-10-04T11:00:00Z");
    const [bumped] = await upsertListings(db, [{ ...base, sourceRefreshedAt: t1 }], t1);
    expect(bumped).toMatchObject({ inserted: false, changed: true, needsAssignment: true }); // never assigned yet

    const [again] = await upsertListings(db, [{ ...base, sourceRefreshedAt: new Date("2026-10-04T12:00:00Z") }], t1);
    expect(again!.changed).toBe(true);
    expect(again!.priceChanged).toBe(false);

    const [repriced] = await upsertListings(db, [{ ...base, price: 90_000 }], t1);
    expect(repriced).toMatchObject({ priceChanged: true, needsAssignment: true, previousPrice: 100_000, price: 90_000 });

    const [moved] = await upsertListings(db, [{ ...base, price: 90_000, lat: 49.98, lon: 20.07 }], t1);
    expect(moved!.needsAssignment).toBe(true);

    const [same] = await upsertListings(db, [{ ...base, price: 90_000, lat: 49.98, lon: 20.07 }], t1);
    expect(same).toMatchObject({ changed: false, priceChanged: false });
  });
});
