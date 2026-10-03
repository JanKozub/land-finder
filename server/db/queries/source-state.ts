import { eq } from "drizzle-orm";
import type { Source } from "../../../shared/constants";
import type { Db } from "../client";
import { sourceState, type SourceStateRow } from "../schema";

export async function getSourceState(db: Db, source: Source): Promise<SourceStateRow> {
  const [row] = await db.select().from(sourceState).where(eq(sourceState.source, source)).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(sourceState)
    .values({ source })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db.select().from(sourceState).where(eq(sourceState.source, source)).limit(1);
  if (!again) throw new Error(`cannot create source_state for ${source}`);
  return again;
}

export async function updateSourceState(
  db: Db,
  source: Source,
  patch: Partial<Omit<SourceStateRow, "source" | "updatedAt">>,
): Promise<void> {
  await getSourceState(db, source);
  await db
    .update(sourceState)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(sourceState.source, source));
}

export async function patchSourceMeta(db: Db, source: Source, patch: Record<string, unknown>): Promise<void> {
  const state = await getSourceState(db, source);
  await updateSourceState(db, source, { meta: { ...state.meta, ...patch } });
}

export async function listSourceStates(db: Db): Promise<SourceStateRow[]> {
  return db.select().from(sourceState);
}
