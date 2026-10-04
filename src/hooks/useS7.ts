import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import type { PropertyDto } from "@shared/schemas";
import {
  S7_VARIANTS,
  buildS7RouteIndex,
  s7ProximityFor,
  type S7FeatureCollection,
  type S7Proximity,
  type S7RouteIndex,
  type S7Variant,
} from "@shared/s7";

export type S7Collections = Partial<Record<S7Variant, S7FeatureCollection>>;

export interface S7Data {
  /** Loaded variants (enabled ones that have finished downloading). */
  collections: S7Collections;
  loading: boolean;
  error: Error | null;
}

async function fetchVariant(variant: S7Variant): Promise<S7FeatureCollection> {
  const res = await fetch(`/data/s7/${variant.toLowerCase()}.geojson`);
  if (!res.ok) throw new Error(`Nie udało się pobrać wariantu ${variant} trasy S7 (HTTP ${res.status})`);
  return (await res.json()) as S7FeatureCollection;
}

// Module-level so TanStack Query can memoize the combined result between renders.
function combine(results: UseQueryResult<S7FeatureCollection, Error>[]): S7Data {
  const collections: S7Collections = {};
  results.forEach((r, i) => {
    if (r.data) collections[S7_VARIANTS[i]!] = r.data;
  });
  return { collections, loading: results.some((r) => r.isLoading), error: results.find((r) => r.error)?.error ?? null };
}

/** Loads the static GeoJSON of the enabled variants once per session. */
export function useS7Data(enabled: readonly S7Variant[]): S7Data {
  return useQueries({
    queries: S7_VARIANTS.map((v) => ({
      queryKey: ["s7", v] as const,
      queryFn: () => fetchVariant(v),
      staleTime: Infinity,
      gcTime: Infinity,
      enabled: enabled.includes(v),
    })),
    combine,
  });
}

const indexCache = new WeakMap<S7FeatureCollection, S7RouteIndex>();

function indexFor(fc: S7FeatureCollection, variant: S7Variant): S7RouteIndex {
  let index = indexCache.get(fc);
  if (!index) {
    index = buildS7RouteIndex(fc, variant);
    indexCache.set(fc, index);
  }
  return index;
}

/** Distance indexes of the enabled variants that are already loaded. */
export function useS7RouteIndexes(collections: S7Collections, enabled: readonly S7Variant[]): S7RouteIndex[] {
  return useMemo(
    () =>
      enabled.flatMap((v) => {
        const fc = collections[v];
        return fc ? [indexFor(fc, v)] : [];
      }),
    [collections, enabled],
  );
}

/** Distance of every located property to each enabled variant, nearest first. */
export function useS7Proximity(items: readonly PropertyDto[], indexes: readonly S7RouteIndex[]): Map<number, S7Proximity[]> {
  return useMemo(() => {
    const map = new Map<number, S7Proximity[]>();
    if (!indexes.length) return map;
    for (const p of items) if (p.lat !== null && p.lon !== null) map.set(p.id, s7ProximityFor(indexes, p.lat, p.lon));
    return map;
  }, [items, indexes]);
}
