import { useQuery } from "@tanstack/react-query";
import type { GminaRecord } from "@shared/area";

/** Gmina boundaries bundled with the app (OpenStreetMap), loaded as a separate chunk the first time they are needed. */
export function useGminy() {
  return useQuery({
    queryKey: ["gminy"],
    queryFn: async (): Promise<{ gminy: GminaRecord[]; attribution: string }> => {
      const mod = await import("@shared/area-data");
      return { gminy: mod.GMINY, attribution: mod.GMINY_ATTRIBUTION };
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
