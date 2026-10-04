import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { FilterSchema, filtersToQuery, parseFilterQuery, type Filters } from "@shared/schemas";
import type { S7Variant } from "@shared/s7";
import { parseS7Filter, parseS7Variants, serializeS7Filter, serializeS7Variants, type S7Filter } from "@/lib/s7";

const DEFAULTS = FilterSchema.parse({});

/** Query params that are not filters but must survive a filter change. */
const PRESERVED_PARAMS = ["focus", "s7", "s7f"] as const;

/** Filters live in the URL so a view can be refreshed or shared. Defaults are omitted from the query string. */
export function useFiltersFromUrl(): { filters: Filters; update: (patch: Partial<Filters>) => void; reset: () => void } {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilterQuery(Object.fromEntries(params)), [params]);

  const write = useCallback(
    (next: Filters) => {
      const q = filtersToQuery(next);
      for (const key of Object.keys(q) as (keyof Filters)[]) {
        if (JSON.stringify(next[key]) === JSON.stringify(DEFAULTS[key])) delete q[key];
      }
      setParams(
        (prev) => {
          const p = new URLSearchParams(q);
          for (const key of PRESERVED_PARAMS) {
            const value = prev.get(key);
            if (value !== null) p.set(key, value);
          }
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return {
    filters,
    update: (patch) => write({ ...filters, ...patch }),
    reset: () => write(DEFAULTS),
  };
}

function useParamSetter(key: string): (value: string | null) => void {
  const [, setParams] = useSearchParams();
  return useCallback(
    (value: string | null) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (value === null) p.delete(key);
          else p.set(key, value);
          return p;
        },
        { replace: true },
      ),
    [setParams, key],
  );
}

export function useFocusParam(): [number | null, (id: number | null) => void] {
  const [params] = useSearchParams();
  const raw = params.get("focus");
  const focus = raw && Number.isInteger(Number(raw)) ? Number(raw) : null;
  const set = useParamSetter("focus");
  const setFocus = useCallback((id: number | null) => set(id === null ? null : String(id)), [set]);
  return [focus, setFocus];
}

export interface S7Params {
  variants: S7Variant[];
  setVariants: (variants: S7Variant[]) => void;
  filter: S7Filter | null;
  setFilter: (filter: S7Filter | null) => void;
}

/** Planned-S7 overlay state (`s7` = enabled variants, `s7f` = proximity filter); all variants are on by default. */
export function useS7Params(): S7Params {
  const [params] = useSearchParams();
  const rawVariants = params.get("s7");
  const rawFilter = params.get("s7f");
  // Memoized on the raw strings so downstream memos (distance index, proximity map) stay stable across renders.
  const variants = useMemo(() => parseS7Variants(rawVariants), [rawVariants]);
  const filter = useMemo(() => parseS7Filter(rawFilter), [rawFilter]);
  const setRawVariants = useParamSetter("s7");
  const setRawFilter = useParamSetter("s7f");
  const setVariants = useCallback((next: S7Variant[]) => setRawVariants(serializeS7Variants(next)), [setRawVariants]);
  const setFilter = useCallback((next: S7Filter | null) => setRawFilter(serializeS7Filter(next)), [setRawFilter]);
  return { variants, setVariants, filter, setFilter };
}
