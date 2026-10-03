import { List, Map as MapIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { PropertyDto } from "@shared/schemas";
import { useFavoriteProperty, useHideProperty, useIgnoreProperty, useProperties, useSettings } from "@/api/hooks";
import { FiltersPanel } from "@/components/filters/FiltersPanel";
import { useFiltersFromUrl, useFocusParam } from "@/components/filters/useFiltersFromUrl";
import { ListPanel, sortItems, type SortKey } from "@/components/listings/ListPanel";
import { PropertyDrawer } from "@/components/listings/PropertyDrawer";
import { MapView } from "@/components/map/MapView";
import { Button, ErrorText } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { haversineKm, inBounds, type Bounds } from "@/lib/geo";
import { rotateLastVisit } from "@/lib/last-visit";

const lastVisit = rotateLastVisit();

export function MapPage() {
  const { filters, update, reset } = useFiltersFromUrl();
  const [focusId, setFocus] = useFocusParam();
  const [detailsId, setDetailsId] = useState<number | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [sort, setSort] = useState<SortKey>("newest");
  const [onlyNew, setOnlyNew] = useState(false);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const settings = useSettings();
  const query = useProperties(filters);
  const hide = useHideProperty();
  const favorite = useFavoriteProperty();
  const ignoreProperty = useIgnoreProperty();

  const items = query.data?.items ?? [];
  const center = query.data?.center ?? settings.data?.center ?? { lat: 49.9873, lon: 20.0646 };
  const radiusKm = query.data?.radiusKm ?? settings.data?.radiusKm ?? 15;

  const isNew = useCallback((p: PropertyDto) => Boolean(lastVisit && p.firstSeenAt > lastVisit), []);
  const distance = useCallback((p: PropertyDto) => (p.lat === null || p.lon === null ? null : haversineKm(center.lat, center.lon, p.lat, p.lon)), [center]);

  const filtered = useMemo(() => (onlyNew ? items.filter(isNew) : items), [items, onlyNew, isNew]);
  const visible = useMemo(() => sortItems(filtered.filter((p) => inBounds(p.lat, p.lon, bounds)), sort, distance), [filtered, bounds, sort, distance]);
  const counts = useMemo(
    () => ({
      plots: filtered.filter((p) => p.kind === "plot").length,
      houses: filtered.filter((p) => p.kind === "house").length,
      fresh: filtered.filter(isNew).length,
      unlocated: filtered.filter((p) => p.lat === null).length,
    }),
    [filtered, isNew],
  );

  const onBoundsChange = useCallback((b: Bounds) => setBounds(b), []);
  const openDetails = useCallback(
    (id: number) => {
      setFocus(id);
      setDetailsId(id);
    },
    [setFocus],
  );
  const focusFromList = useCallback(
    (id: number) => {
      setFocus(id);
      setMobileView("map");
    },
    [setFocus],
  );
  const toggleHidden = useCallback((item: PropertyDto) => hide.mutate({ id: item.id, hidden: !item.hidden }), [hide]);
  const toggleFavorite = useCallback((item: PropertyDto) => favorite.mutate({ id: item.id, favorite: !item.favorite }), [favorite]);
  const toggleIgnored = useCallback((item: PropertyDto) => ignoreProperty.mutate({ id: item.id, ignored: !item.ignored }), [ignoreProperty]);

  return (
    <div className="relative flex h-full">
      <aside className={cn("flex w-full shrink-0 flex-col border-r border-slate-200 bg-slate-50 md:w-[400px]", mobileView === "map" && "hidden md:flex")}>
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold text-plot">{counts.plots} działek</span>
          <span className="font-semibold text-house">{counts.houses} domów</span>
          {counts.fresh > 0 && <span className="font-semibold text-sky-700">{counts.fresh} nowych</span>}
          {counts.unlocated > 0 && <span title="Oferty bez współrzędnych nie są widoczne na mapie">{counts.unlocated} bez mapy</span>}
          {query.isFetching && <span className="ml-auto animate-pulse">odświeżanie…</span>}
        </div>
        <FiltersPanel filters={filters} onChange={update} onReset={reset} onlyNew={onlyNew} setOnlyNew={setOnlyNew} hasLastVisit={lastVisit !== null} />
        <ErrorText error={query.error} />
        <ListPanel
          items={visible}
          totalLoaded={filtered.length}
          sort={sort}
          setSort={setSort}
          focusId={focusId}
          onFocus={focusFromList}
          onDetails={openDetails}
          onToggleHidden={toggleHidden}
          onToggleFavorite={toggleFavorite}
          isNew={isNew}
          distance={distance}
          loading={query.isLoading}
        />
      </aside>
      <main className={cn("relative min-w-0 flex-1", mobileView === "list" && "hidden md:block")}>
        <MapView
          items={filtered}
          center={center}
          radiusKm={radiusKm}
          focusId={focusId}
          onFocus={setFocus}
          onDetails={openDetails}
          onBoundsChange={onBoundsChange}
          isNew={isNew}
          onToggleFavorite={toggleFavorite}
          onToggleIgnored={toggleIgnored}
        />
        {detailsId !== null && <PropertyDrawer id={detailsId} onClose={() => setDetailsId(null)} onNavigate={(id) => openDetails(id)} />}
      </main>
      <Button
        className="absolute bottom-4 left-1/2 z-[1001] -translate-x-1/2 shadow-lg md:hidden"
        variant="primary"
        onClick={() => setMobileView((v) => (v === "map" ? "list" : "map"))}
      >
        {mobileView === "map" ? <List className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
        {mobileView === "map" ? "Lista" : "Mapa"}
      </Button>
    </div>
  );
}
