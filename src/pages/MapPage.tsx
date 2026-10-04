import { List, Map as MapIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { PropertyDto } from "@shared/schemas";
import { S7_NEAR_M, s7ProximityFor } from "@shared/s7";
import { useFavoriteProperty, useHideProperty, useIgnoreProperty, useProperties, useSettings } from "@/api/hooks";
import { FiltersPanel } from "@/components/filters/FiltersPanel";
import { S7Controls } from "@/components/filters/S7Controls";
import { useFiltersFromUrl, useFocusParam, useS7Params } from "@/components/filters/useFiltersFromUrl";
import { ListPanel, sortItems, type SortKey } from "@/components/listings/ListPanel";
import { PropertyDrawer } from "@/components/listings/PropertyDrawer";
import { MapView } from "@/components/map/MapView";
import { Button, ErrorText } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { useS7Data, useS7Proximity, useS7RouteIndexes } from "@/hooks/useS7";
import { haversineKm, inBounds, type Bounds } from "@/lib/geo";
import { rotateLastVisit } from "@/lib/last-visit";
import { matchesS7Filter } from "@/lib/s7";

const lastVisit = rotateLastVisit();
const EMPTY_ITEMS: PropertyDto[] = [];

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

  const items = query.data?.items ?? EMPTY_ITEMS;
  const center = query.data?.center ?? settings.data?.center ?? { lat: 49.9873, lon: 20.0646 };
  const radiusKm = query.data?.radiusKm ?? settings.data?.radiusKm ?? 15;

  // Planned S7 route variants: static GeoJSON, distances computed client-side.
  const s7Params = useS7Params();
  const s7 = useS7Data(s7Params.variants);
  const s7Indexes = useS7RouteIndexes(s7.collections, s7Params.variants);
  const s7Proximity = useS7Proximity(items, s7Indexes);
  const s7Of = useCallback((p: PropertyDto) => s7Proximity.get(p.id) ?? null, [s7Proximity]);
  const s7For = useCallback((lat: number, lon: number) => s7ProximityFor(s7Indexes, lat, lon), [s7Indexes]);
  const s7Filter = s7Params.filter;

  const isNew = useCallback((p: PropertyDto) => Boolean(lastVisit && p.firstSeenAt > lastVisit), []);
  const distance = useCallback((p: PropertyDto) => (p.lat === null || p.lon === null ? null : haversineKm(center.lat, center.lon, p.lat, p.lon)), [center]);

  const filtered = useMemo(() => {
    let list = onlyNew ? items.filter(isNew) : items;
    // The S7 filter waits for the geometry so the list does not flash empty while it loads.
    if (s7Filter && s7Indexes.length > 0) list = list.filter((p) => matchesS7Filter(s7Proximity.get(p.id), s7Filter));
    return list;
  }, [items, onlyNew, isNew, s7Filter, s7Indexes, s7Proximity]);
  const visible = useMemo(() => sortItems(filtered.filter((p) => inBounds(p.lat, p.lon, bounds)), sort, distance), [filtered, bounds, sort, distance]);
  const counts = useMemo(
    () => ({
      plots: filtered.filter((p) => p.kind === "plot").length,
      houses: filtered.filter((p) => p.kind === "house").length,
      fresh: filtered.filter(isNew).length,
      unlocated: filtered.filter((p) => p.lat === null).length,
      nearS7: filtered.filter((p) => (s7Proximity.get(p.id)?.[0]?.meters ?? Infinity) <= S7_NEAR_M).length,
    }),
    [filtered, isNew, s7Proximity],
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
          {counts.fresh > 0 && <span className="font-semibold text-violet-700">{counts.fresh} nowych</span>}
          {counts.unlocated > 0 && <span title="Oferty bez współrzędnych nie są widoczne na mapie">{counts.unlocated} bez mapy</span>}
          {counts.nearS7 > 0 && (
            <span className="font-semibold text-rose-700" title="Oferty położone do 500 m od osi któregoś z włączonych wariantów planowanej S7">
              {counts.nearS7} przy S7
            </span>
          )}
          {query.isFetching && <span className="ml-auto animate-pulse">odświeżanie…</span>}
        </div>
        <FiltersPanel
          filters={filters}
          onChange={update}
          onReset={reset}
          onlyNew={onlyNew}
          setOnlyNew={setOnlyNew}
          hasLastVisit={lastVisit !== null}
          extra={
            <S7Controls
              variants={s7Params.variants}
              setVariants={s7Params.setVariants}
              filter={s7Params.filter}
              setFilter={s7Params.setFilter}
              loading={s7.loading}
              error={s7.error}
            />
          }
        />
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
          s7={s7Of}
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
          s7Collections={s7.collections}
          s7Variants={s7Params.variants}
          s7Of={s7Of}
        />
        {detailsId !== null && (
          <PropertyDrawer id={detailsId} onClose={() => setDetailsId(null)} onNavigate={(id) => openDetails(id)} s7For={s7Indexes.length ? s7For : undefined} />
        )}
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
