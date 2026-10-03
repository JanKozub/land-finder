import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { FilterSchema, filtersToQuery, parseFilterQuery, type Filters } from "@shared/schemas";

const DEFAULTS = FilterSchema.parse({});

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
          const focus = prev.get("focus");
          if (focus) p.set("focus", focus);
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

export function useFocusParam(): [number | null, (id: number | null) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("focus");
  const focus = raw && Number.isInteger(Number(raw)) ? Number(raw) : null;
  const setFocus = useCallback(
    (id: number | null) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (id === null) p.delete("focus");
          else p.set("focus", String(id));
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [focus, setFocus];
}
