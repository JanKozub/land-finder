import { S7_VARIANTS, isS7Variant, type S7Proximity, type S7Variant } from "@shared/s7";

/** Line colours follow GDDKiA's own variant palette so the overlay matches the official maps. */
export const S7_COLORS: Record<S7Variant, string> = {
  A: "#15803d", // green
  B: "#ea580c", // orange
  C: "#7e22ce", // purple
  D: "#92400e", // brown
  E: "#ca8a04", // yellow
  F: "#db2777", // magenta
};

export function s7VariantLabel(variant: S7Variant): string {
  return `Wariant ${variant}`;
}

export type S7FilterMode = "near" | "far";
export interface S7Filter {
  mode: S7FilterMode;
  /** Threshold distance to the nearest enabled variant's axis, in metres. */
  meters: number;
}

export const S7_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "S7: bez filtra" },
  { value: "near:200", label: "Tylko do 200 m od S7" },
  { value: "near:500", label: "Tylko do 500 m od S7" },
  { value: "near:1000", label: "Tylko do 1 km od S7" },
  { value: "far:300", label: "Tylko dalej niż 300 m od S7" },
  { value: "far:1000", label: "Tylko dalej niż 1 km od S7" },
];

/** `s7f` URL param, e.g. "near:500". */
export function parseS7Filter(raw: string | null | undefined): S7Filter | null {
  if (!raw) return null;
  const m = /^(near|far):(\d{1,6})$/.exec(raw);
  return m ? { mode: m[1] as S7FilterMode, meters: Number(m[2]) } : null;
}

export function serializeS7Filter(filter: S7Filter | null): string | null {
  return filter ? `${filter.mode}:${filter.meters}` : null;
}

/** `s7` URL param: absent = all variants, "none" = overlay off, otherwise a CSV of variant letters. */
export function parseS7Variants(raw: string | null | undefined): S7Variant[] {
  if (raw === null || raw === undefined || raw === "") return [...S7_VARIANTS];
  if (raw === "none") return [];
  const wanted = new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(isS7Variant));
  return S7_VARIANTS.filter((v) => wanted.has(v));
}

export function serializeS7Variants(variants: readonly S7Variant[]): string | null {
  if (variants.length === S7_VARIANTS.length) return null;
  if (variants.length === 0) return "none";
  return S7_VARIANTS.filter((v) => variants.includes(v)).join(",");
}

/** Properties without coordinates never match (their distance is unknown). */
export function matchesS7Filter(proximity: readonly S7Proximity[] | null | undefined, filter: S7Filter): boolean {
  const nearest = proximity?.[0];
  if (!nearest) return false;
  return filter.mode === "near" ? nearest.meters <= filter.meters : nearest.meters > filter.meters;
}
