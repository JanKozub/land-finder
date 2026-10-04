import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Filters, ListingsQuery, Settings } from "@shared/schemas";
import { api } from "./client";

export const queryKeys = {
  properties: (f: Partial<Filters>) => ["properties", f] as const,
  property: (id: number) => ["property", id] as const,
  settings: ["settings"] as const,
  status: ["scrape-status"] as const,
  runs: ["runs"] as const,
};

export function useProperties(filters: Partial<Filters>) {
  return useQuery({ queryKey: queryKeys.properties(filters), queryFn: () => api.properties(filters), placeholderData: (prev) => prev });
}

export function useListingsTable(query: ListingsQuery) {
  return useQuery({ queryKey: ["listings-table", query], queryFn: () => api.listings(query), placeholderData: (prev) => prev });
}

export function useProperty(id: number | null) {
  return useQuery({ queryKey: queryKeys.property(id ?? 0), queryFn: () => api.property(id!), enabled: id !== null });
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.settings, staleTime: 5 * 60_000 });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Settings) => api.saveSettings(s),
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.settings, saved);
      void qc.invalidateQueries({ queryKey: ["properties"] });
      // A new rectangle changes which stored listings are "outside".
      void qc.invalidateQueries({ queryKey: ["area-outside"] });
    },
  });
}

export function useScrapeStatus(pollMs: number | false) {
  return useQuery({ queryKey: queryKeys.status, queryFn: api.scrapeStatus, refetchInterval: pollMs });
}

export function useRuns(limit = 20) {
  return useQuery({ queryKey: [...queryKeys.runs, limit], queryFn: () => api.runs(limit) });
}

export function useInvalidateProperties() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["properties"] });
    void qc.invalidateQueries({ queryKey: ["property"] });
    void qc.invalidateQueries({ queryKey: ["listings-table"] });
  };
}

export function useFavoriteProperty() {
  const invalidate = useInvalidateProperties();
  return useMutation({ mutationFn: ({ id, favorite }: { id: number; favorite: boolean }) => api.favorite(id, favorite), onSuccess: invalidate });
}

export function useIgnoreProperty() {
  const invalidate = useInvalidateProperties();
  return useMutation({ mutationFn: ({ id, ignored }: { id: number; ignored: boolean }) => api.ignoreProperty(id, ignored), onSuccess: invalidate });
}

export function useIgnoreListing() {
  const invalidate = useInvalidateProperties();
  return useMutation({ mutationFn: ({ id, ignored }: { id: number; ignored: boolean }) => api.ignoreListing(id, ignored), onSuccess: invalidate });
}

export function useAreaOutside() {
  return useQuery({ queryKey: ["area-outside"], queryFn: api.areaOutside, staleTime: 30_000 });
}

export function useAreaPrune() {
  const qc = useQueryClient();
  const invalidate = useInvalidateProperties();
  return useMutation({
    mutationFn: api.areaPrune,
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ["area-outside"] });
      void qc.invalidateQueries({ queryKey: queryKeys.status });
    },
  });
}

export function useBulkIgnoreListings() {
  const invalidate = useInvalidateProperties();
  return useMutation({
    mutationFn: ({ query, ignored }: { query: Partial<ListingsQuery>; ignored: boolean }) => api.bulkIgnoreListings(query, ignored),
    onSuccess: invalidate,
  });
}

export function useHideProperty() {
  const invalidate = useInvalidateProperties();
  return useMutation({ mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) => api.hide(id, hidden), onSuccess: invalidate });
}

export function useSaveNote() {
  const invalidate = useInvalidateProperties();
  return useMutation({ mutationFn: ({ id, note }: { id: number; note: string | null }) => api.note(id, note), onSuccess: invalidate });
}

export function useDetachListing() {
  const invalidate = useInvalidateProperties();
  return useMutation({ mutationFn: (listingId: number) => api.detach(listingId), onSuccess: invalidate });
}

export function useMergeProperty() {
  const invalidate = useInvalidateProperties();
  return useMutation({ mutationFn: ({ id, sourcePropertyId }: { id: number; sourcePropertyId: number }) => api.merge(id, sourcePropertyId), onSuccess: invalidate });
}
