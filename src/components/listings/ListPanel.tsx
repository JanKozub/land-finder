import { useState } from "react";
import type { PropertyDto } from "@shared/schemas";
import { Button, Select } from "../ui";
import { PropertyCard } from "./PropertyCard";

export type SortKey = "newest" | "price_asc" | "price_desc" | "area_desc" | "ppm2_asc" | "distance";

export function sortItems(items: PropertyDto[], sort: SortKey, distance: (p: PropertyDto) => number | null): PropertyDto[] {
  const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return (a - b) * dir;
  };
  const sorted = items.slice();
  switch (sort) {
    case "price_asc":
      return sorted.sort((a, b) => nullsLast(a.price, b.price, 1));
    case "price_desc":
      return sorted.sort((a, b) => nullsLast(a.price, b.price, -1));
    case "area_desc":
      return sorted.sort((a, b) => nullsLast(a.areaM2, b.areaM2, -1));
    case "ppm2_asc":
      return sorted.sort((a, b) => nullsLast(a.pricePerM2, b.pricePerM2, 1));
    case "distance":
      return sorted.sort((a, b) => nullsLast(distance(a), distance(b), 1));
    default:
      return sorted.sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));
  }
}

const PAGE = 100;

export function ListPanel({
  items,
  totalLoaded,
  sort,
  setSort,
  focusId,
  onFocus,
  onDetails,
  onToggleHidden,
  onToggleFavorite,
  isNew,
  distance,
  loading,
}: {
  items: PropertyDto[];
  totalLoaded: number;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  focusId: number | null;
  onFocus: (id: number) => void;
  onDetails: (id: number) => void;
  onToggleHidden: (item: PropertyDto) => void;
  onToggleFavorite: (item: PropertyDto) => void;
  isNew: (item: PropertyDto) => boolean;
  distance: (item: PropertyDto) => number | null;
  loading: boolean;
}) {
  const [limit, setLimit] = useState(PAGE);
  const shown = items.slice(0, limit);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <span>
          {loading ? "Ładowanie…" : `${items.length} w widoku z ${totalLoaded}`}
        </span>
        <Select className="ml-auto h-8 w-auto text-xs" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="newest">Najnowsze</option>
          <option value="price_asc">Cena rosnąco</option>
          <option value="price_desc">Cena malejąco</option>
          <option value="ppm2_asc">zł/m² rosnąco</option>
          <option value="area_desc">Powierzchnia malejąco</option>
          <option value="distance">Najbliżej centrum</option>
        </Select>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {shown.map((item) => (
          <PropertyCard
            key={item.id}
            item={item}
            isNew={isNew(item)}
            distanceKm={distance(item)}
            active={focusId === item.id}
            onFocus={onFocus}
            onDetails={onDetails}
            onToggleHidden={onToggleHidden}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
        {items.length === 0 && !loading && (
          <p className="p-6 text-center text-sm text-slate-500">Brak ofert w tym widoku. Przesuń mapę albo zmień filtry.</p>
        )}
        {items.length > limit && (
          <Button className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
            Pokaż więcej ({items.length - limit})
          </Button>
        )}
      </div>
    </div>
  );
}
