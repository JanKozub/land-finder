import { parseArgs } from "node:util";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { haversineKm } from "../shared/geo";
import { createDb } from "../server/db/client";
import { listings } from "../server/db/schema";
import { toCandidate } from "../server/dedup/match";
import { decide } from "../server/dedup/decide";
import { reassignAll } from "../server/dedup/reassign";
import { env } from "../server/env";

/**
 * Cross-portal duplicate tooling:
 *   pnpm dedup:report    — how many properties combine several portals, plus near-duplicates that were NOT merged
 *   pnpm dedup:reassign  — re-runs the matching rules over every listing (after a rules change); 2 passes
 * Both accept --database-url to target another database (e.g. production). With the local PGlite database stop
 * `pnpm dev` first: two processes on one PGlite directory corrupt it.
 */
async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { "database-url": { type: "string" }, limit: { type: "string", default: "40" }, passes: { type: "string", default: "2" } } });
  const mode = positionals[0] ?? "report";
  const handle = await createDb(values["database-url"] ?? env.databaseUrl);
  const { db } = handle;
  try {
    if (mode === "reassign") await reassign(db, Number(values.passes));
    else await report(db, Number(values.limit));
  } finally {
    await handle.close();
  }
}

type Db = Awaited<ReturnType<typeof createDb>>["db"];

async function report(db: Db, limit: number) {
  const q = async <T>(s: ReturnType<typeof sql>): Promise<T[]> => ((await db.execute(s)) as unknown as { rows?: T[] }).rows ?? ((await db.execute(s)) as unknown as T[]);
  const totals = await q<{ props: number; multi: number }>(sql`select count(*)::int as props, count(*) filter (where (select count(distinct source) from listings l where l.property_id = p.id) > 1)::int as multi from properties p where is_active`);
  console.log(`Active properties: ${totals[0]?.props}, with listings from 2+ portals: ${totals[0]?.multi}`);
  const combos = await q<{ sources: string; n: number }>(sql`select sources, count(*)::int as n from (select p.id, string_agg(distinct l.source, '+' order by l.source) as sources from listings l join properties p on p.id = l.property_id where p.is_active group by p.id) t where sources like '%+%' group by sources order by n desc`);
  for (const c of combos) console.log(`  ${c.sources}: ${c.n}`);
  const bySource = await q<{ source: string; n: number; coords: number; assigned: number }>(sql`select source, count(*)::int as n, count(lat)::int as coords, count(property_id)::int as assigned from listings where is_active group by source order by source`);
  console.log("Listings per portal (active / with coordinates / assigned to a property):");
  for (const s of bySource) console.log(`  ${s.source}: ${s.n} / ${s.coords} / ${s.assigned}`);

  // Near-duplicates across portals that the rules kept apart: same kind, within 2 km, area ±10 %, price ±10 %.
  const rows = await db.select().from(listings).where(and(eq(listings.isActive, true), isNotNull(listings.lat), isNotNull(listings.propertyId)));
  const suspects: { a: typeof rows[number]; b: typeof rows[number]; dist: number; reason: string }[] = [];
  const byKind = new Map<string, typeof rows>();
  for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  for (const group of byKind.values()) {
    group.sort((x, y) => x.lat! - y.lat!);
    for (let i = 0; i < group.length; i++) {
      const a = group[i]!;
      for (let j = i + 1; j < group.length && group[j]!.lat! - a.lat! < 0.02; j++) {
        const b = group[j]!;
        if (a.source === b.source || a.propertyId === b.propertyId) continue;
        if (a.price === null || b.price === null || a.areaM2 === null || b.areaM2 === null) continue;
        if (Math.abs(a.price - b.price) / Math.max(a.price, b.price) > 0.1) continue;
        if (Math.abs(a.areaM2 - b.areaM2) / Math.max(a.areaM2, b.areaM2) > 0.1) continue;
        const dist = haversineKm(a.lat!, a.lon!, b.lat!, b.lon!);
        if (dist > 2) continue;
        suspects.push({ a, b, dist, reason: decide(toCandidate(a), toCandidate(b)).reason });
      }
    }
  }
  suspects.sort((x, y) => x.dist - y.dist);
  console.log(`\nNear-duplicates across portals NOT merged (same kind, ≤2 km, area ±10 %, price ±10 %): ${suspects.length}`);
  const byReason = new Map<string, number>();
  for (const s of suspects) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  for (const [reason, n] of [...byReason.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${reason}: ${n}`);
  for (const s of suspects.slice(0, limit)) {
    console.log(`\n  [${s.reason}] ${s.dist.toFixed(2)} km`);
    for (const l of [s.a, s.b]) console.log(`    ${l.source.padEnd(21)} #${l.id} ${l.price} zł ${l.areaM2} m² ${l.locationPrecision.padEnd(7)} ${(l.advertiserName ?? "-").slice(0, 28).padEnd(28)} ${l.title.slice(0, 60)}`);
  }
}

async function reassign(db: Db, passes: number) {
  await reassignAll(db, { passes, onPass: (pass, processed, moved) => console.log(`pass ${pass}: ${processed} listings re-evaluated, ${moved} moved to another property`) });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
