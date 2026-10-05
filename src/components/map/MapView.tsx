import { Ban, Heart, RotateCcw } from "lucide-react";
import type { CircleMarker as LeafletCircleMarker, LatLngBounds, Popup as LeafletPopup } from "leaflet";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, Rectangle, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Area } from "@shared/area";
import type { PropertyDto } from "@shared/schemas";
import type { S7Proximity, S7Variant } from "@shared/s7";
import { splitOverlapping, spreadOverlapping } from "@shared/spread";
import type { S7Collections } from "@/hooks/useS7";
import { formatArea, formatPln, formatPricePerM2 } from "@/lib/format";
import type { Bounds } from "@/lib/geo";
import { Button } from "../ui";
import { cn } from "../ui/cn";
import { KindBadge, SourceLinks } from "../listings/PropertyCard";
import { S7Badge, S7Distances } from "../listings/S7Badge";
import { S7Overlay } from "./S7Overlay";

export interface MapViewProps {
  items: PropertyDto[];
  center: { lat: number; lon: number };
  area: Area;
  focusId: number | null;
  onFocus: (id: number | null) => void;
  onDetails: (id: number) => void;
  onBoundsChange: (b: Bounds) => void;
  isNew: (item: PropertyDto) => boolean;
  onToggleFavorite: (item: PropertyDto) => void;
  onToggleIgnored: (item: PropertyDto) => void;
  /** Planned S7 overlay: loaded variant geometries and which variants to draw. */
  s7Collections: S7Collections;
  s7Variants: readonly S7Variant[];
  /** Distances of a property to the enabled variants, nearest first. */
  s7Of: (item: PropertyDto) => readonly S7Proximity[] | null;
}

type LatLon = [number, number];

const POPUP_OFFSET: LatLon = [0, -6];

const COLORS = {
  plot: "#38bdf8",
  house: "#d97706",
  hidden: "#94a3b8",
  inactive: "#475569",
  favorite: "#ec4899",
  favoriteStroke: "#be185d",
  focus: "#0f172a",
} as const;

function toBounds(b: LatLngBounds): Bounds {
  return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
}

function ViewportSync({ onBoundsChange }: { onBoundsChange: (b: Bounds) => void }) {
  const map = useMap();
  useEffect(() => {
    onBoundsChange(toBounds(map.getBounds()));
  }, [map, onBoundsChange]);
  useMapEvents({ moveend: () => onBoundsChange(toBounds(map.getBounds())) });
  return null;
}

/** Brings the focused property into view only when it is outside the current viewport (never fights a drag). */
function FocusController({ focusId, lat, lon }: { focusId: number | null; lat: number | null; lon: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (focusId === null || lat === null || lon === null) return;
    const target: [number, number] = [lat, lon];
    if (!map.getBounds().pad(-0.1).contains(target)) map.flyTo(target, Math.max(map.getZoom(), 13), { duration: 0.5 });
    // Only re-run when the focused id changes; data refetches must not move the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, map]);
  return null;
}

interface MarkerProps {
  id: number;
  lat: number;
  lon: number;
  radius: number;
  stroke: string;
  weight: number;
  dashed: boolean;
  fill: string;
  fillOpacity: number;
  onFocus: (id: number) => void;
  /** Receives the Leaflet layer, for dots whose displayed position is adjusted outside React (see the spread). */
  markerRef?: (layer: LeafletCircleMarker | null) => void;
}

/** Memoized so that map moves and list updates do not touch hundreds of Leaflet layers. */
const PropertyMarker = memo(function PropertyMarker(p: MarkerProps) {
  const pathOptions = useMemo(
    () => ({ color: p.stroke, weight: p.weight, dashArray: p.dashed ? "3 3" : undefined, fillColor: p.fill, fillOpacity: p.fillOpacity }),
    [p.stroke, p.weight, p.dashed, p.fill, p.fillOpacity],
  );
  const eventHandlers = useMemo(() => ({ click: () => p.onFocus(p.id) }), [p.onFocus, p.id]);
  // A stable centre: react-leaflet resets the layer position whenever this prop changes identity, which would undo
  // a spread offset on every unrelated re-render (focus, favourite).
  const center = useMemo<LatLon>(() => [p.lat, p.lon], [p.lat, p.lon]);
  return <CircleMarker ref={p.markerRef} center={center} radius={p.radius} pathOptions={pathOptions} eventHandlers={eventHandlers} />;
});

function PopupContent({
  item,
  s7,
  onDetails,
  onToggleFavorite,
  onToggleIgnored,
}: {
  item: PropertyDto;
  s7: readonly S7Proximity[] | null;
  onDetails: (id: number) => void;
  onToggleFavorite: (item: PropertyDto) => void;
  onToggleIgnored: (item: PropertyDto) => void;
}) {
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <KindBadge kind={item.kind} />
        <S7Badge proximity={s7} />
        {item.favorite && <span className="rounded-sm bg-pink-100 px-1.5 py-0.5 text-[11px] font-semibold text-pink-700">♥ ulubione</span>}
        {item.ignored && <span className="rounded-sm bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">ignorowane</span>}
        {item.hidden && <span className="rounded-sm bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">ukryte</span>}
        <span className="font-bold">{formatPln(item.price)}</span>
        {item.pricePerM2 !== null && <span className="text-slate-500">· {formatPricePerM2(item.pricePerM2)}</span>}
      </div>
      <p className="font-semibold leading-snug">{item.title}</p>
      <p className="text-slate-700">
        {formatArea(item.areaM2, item.kind)}
        {item.kind === "house" && item.plotAreaM2 !== null && ` · działka ${formatArea(item.plotAreaM2, "plot")}`}
      </p>
      <p className="text-xs text-slate-500">{[item.city, item.district].filter(Boolean).join(", ")}</p>
      {s7 && s7.length > 0 && (
        <div className="pt-0.5">
          <p className="text-[11px] font-semibold text-slate-500">Planowana S7 – odległość od osi wariantów</p>
          <S7Distances proximity={s7} className="mt-0.5" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Button size="sm" variant="primary" onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}>
          Otwórz ofertę
        </Button>
        <SourceLinks links={item.links} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => onDetails(item.id)}>
          Szczegóły
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onToggleFavorite(item)} title={item.favorite ? "Usuń z ulubionych" : "Dodaj do ulubionych"} aria-pressed={item.favorite}>
          <Heart className={cn("h-3.5 w-3.5", item.favorite ? "fill-pink-500 text-pink-600" : "")} />
          {item.favorite ? "Ulubione" : "Do ulubionych"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onToggleIgnored(item)}
          title={item.ignored ? "Przywróć wszystkie ogłoszenia tej nieruchomości" : "Ignoruj wszystkie ogłoszenia tej nieruchomości"}
        >
          {item.ignored ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
          {item.ignored ? "Przywróć" : "Ignoruj"}
        </Button>
      </div>
    </div>
  );
}

const LEG_STYLE = { color: "#64748b", weight: 1, opacity: 0.55 } as const;

/**
 * Markers are rendered for a window of one extra viewport on every side. Zoomed in, that is a few dozen dots instead
 * of thousands; zoomed out, the window holds everything and a pan never leaves it, so nothing is re-rendered.
 */
const RENDER_WINDOW_PAD = 1;
/**
 * The window shrinks only once the viewport is this many times narrower than it (about two zoom levels in). Adding
 * thousands of Leaflet layers back is the expensive direction, so a step in and out again must not rebuild the dots.
 */
const RENDER_WINDOW_SHRINK_RATIO = 12;

function nextRenderWindow(current: LatLngBounds, viewport: LatLngBounds): LatLngBounds {
  if (!current.contains(viewport)) return viewport.pad(RENDER_WINDOW_PAD);
  const viewWidth = viewport.getEast() - viewport.getWest();
  if (viewWidth > 0 && current.getEast() - current.getWest() > RENDER_WINDOW_SHRINK_RATIO * viewWidth) return viewport.pad(RENDER_WINDOW_PAD);
  return current;
}

/**
 * The popup of the focused property. react-leaflet re-creates a popup whenever its `position` prop changes identity
 * (which fires `remove` and would clear the focus), so the prop stays at the first position and later moves — the
 * spread ring shifts with the zoom level — are applied to the Leaflet instance directly.
 */
function FocusedPopup({ pos, events, children }: { pos: LatLon; events: { remove: () => void }; children: React.ReactNode }) {
  const [initial] = useState<LatLon>(pos);
  const ref = useRef<LeafletPopup>(null);
  const [lat, lon] = pos;
  useEffect(() => {
    ref.current?.setLatLng([lat, lon]);
  }, [lat, lon]);
  return (
    <Popup ref={ref} position={initial} eventHandlers={events} offset={POPUP_OFFSET}>
      {children}
    </Popup>
  );
}

/** Marker look for a property: colour by state, size by focus/novelty, dashed when the position is approximate. */
function markerStyle(item: PropertyDto, isFocused: boolean, fresh: boolean): Omit<MarkerProps, "id" | "lat" | "lon" | "onFocus"> {
  const muted = item.hidden || item.ignored;
  const fill = muted ? COLORS.hidden : item.favorite ? COLORS.favorite : !item.isActive ? COLORS.inactive : COLORS[item.kind];
  return {
    radius: isFocused ? 10 : item.favorite || fresh ? 8 : 6,
    stroke: isFocused ? COLORS.focus : item.favorite && !muted ? COLORS.favoriteStroke : fill,
    weight: isFocused ? 3 : item.favorite && !muted ? 2 : item.locationPrecision === "approx" ? 1.5 : 1,
    dashed: item.locationPrecision === "approx",
    fill,
    fillOpacity: muted ? 0.4 : 0.85,
  };
}

interface DotsProps {
  items: PropertyDto[];
  focusId: number | null;
  onFocus: (id: number | null) => void;
  isNew: (item: PropertyDto) => boolean;
}

/** Dots that stand alone on their spot: independent of the zoom level, so they only re-render when the set or the focus changes. */
const SoloMarkers = memo(function SoloMarkers({ items, focusId, onFocus, isNew }: DotsProps) {
  return (
    <>
      {items.map((item) => (
        <PropertyMarker key={item.id} id={item.id} lat={item.lat!} lon={item.lon!} onFocus={onFocus} {...markerStyle(item, item.id === focusId, isNew(item))} />
      ))}
    </>
  );
});

interface MarkerLayerProps {
  /** Located properties only. */
  items: PropertyDto[];
  focusId: number | null;
  onFocus: (id: number | null) => void;
  onDetails: (id: number) => void;
  onToggleFavorite: (item: PropertyDto) => void;
  onToggleIgnored: (item: PropertyDto) => void;
  isNew: (item: PropertyDto) => boolean;
  s7Of: (item: PropertyDto) => readonly S7Proximity[] | null;
}

/**
 * Property dots, the overlap spreading, the focus controller and the single popup (all need the map instance).
 * Memoized: a pan re-renders the page (the list follows the viewport) but must not touch the dots.
 */
const MarkerLayer = memo(function MarkerLayer({ items, focusId, onFocus, onDetails, onToggleFavorite, onToggleIgnored, isNew, s7Of }: MarkerLayerProps) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [renderWindow, setRenderWindow] = useState<LatLngBounds>(() => map.getBounds().pad(RENDER_WINDOW_PAD));
  useMapEvents({
    zoomend: () => {
      setZoom(map.getZoom());
      setRenderWindow((current) => nextRenderWindow(current, map.getBounds()));
    },
    moveend: () => setRenderWindow((current) => nextRenderWindow(current, map.getBounds())),
  });

  const focused = useMemo(() => items.find((i) => i.id === focusId) ?? null, [items, focusId]);
  const inWindow = useMemo(() => {
    // A map without a size yet (hidden panel) has no usable bounds: show everything rather than nothing.
    if (!renderWindow.isValid() || renderWindow.getEast() <= renderWindow.getWest()) return items;
    return items.filter((i) => i.id === focusId || renderWindow.contains([i.lat!, i.lon!]));
  }, [items, renderWindow, focusId]);
  const { solo, grouped } = useMemo(() => splitOverlapping(inWindow), [inWindow]);
  // Recomputed per zoom level for the shared spots only: the spread is defined in pixels.
  const spread = useMemo(() => spreadOverlapping(map, grouped), [map, grouped, zoom]);
  const focusedPos: LatLon | null = focused && focused.lat !== null && focused.lon !== null ? (spread.positions.get(focused.id) ?? [focused.lat, focused.lon]) : null;

  // Grouped dots are rendered at their real spot with stable props; the zoom-dependent offset is applied to the
  // Leaflet layers directly, so a zoom moves a thousand dots without re-rendering a thousand components.
  const groupedLayers = useRef(new Map<number, LeafletCircleMarker>());
  const refCallbacks = useRef(new Map<number, (layer: LeafletCircleMarker | null) => void>());
  const markerRefFor = (id: number) => {
    let callback = refCallbacks.current.get(id);
    if (!callback) {
      callback = (layer) => {
        if (layer) groupedLayers.current.set(id, layer);
        else groupedLayers.current.delete(id);
      };
      refCallbacks.current.set(id, callback);
    }
    return callback;
  };
  useEffect(() => {
    for (const [id, pos] of spread.positions) groupedLayers.current.get(id)?.setLatLng(pos);
  }, [spread]);
  // One multi-polyline for every leg: a single layer to update per zoom instead of one component per group.
  const legLines = useMemo(() => spread.legs.flat(), [spread]);

  // Closing the popup (× or map click) clears the focus. The handler is bound to the popup's own property, so swapping
  // the focus to another property (which removes this popup) keeps the new one.
  const focusIdRef = useRef(focusId);
  focusIdRef.current = focusId;
  const focusedId = focused?.id ?? null;
  const popupEvents = useMemo(
    () => ({
      remove: () => {
        if (focusedId !== null && focusIdRef.current === focusedId) onFocus(null);
      },
    }),
    [focusedId, onFocus],
  );

  return (
    <>
      <SoloMarkers items={solo} focusId={focusId} onFocus={onFocus} isNew={isNew} />
      {legLines.length > 0 && <Polyline positions={legLines} pathOptions={LEG_STYLE} interactive={false} />}
      {grouped.map((item) => (
        <PropertyMarker key={item.id} id={item.id} lat={item.lat!} lon={item.lon!} onFocus={onFocus} markerRef={markerRefFor(item.id)} {...markerStyle(item, item.id === focusId, isNew(item))} />
      ))}
      <FocusController focusId={focusId} lat={focusedPos?.[0] ?? null} lon={focusedPos?.[1] ?? null} />
      {focused && focusedPos && (
        <FocusedPopup key={focused.id} pos={focusedPos} events={popupEvents}>
          <PopupContent item={focused} s7={s7Of(focused)} onDetails={onDetails} onToggleFavorite={onToggleFavorite} onToggleIgnored={onToggleIgnored} />
        </FocusedPopup>
      )}
    </>
  );
});

export function MapView({
  items,
  center,
  area,
  focusId,
  onFocus,
  onDetails,
  onBoundsChange,
  isNew,
  onToggleFavorite,
  onToggleIgnored,
  s7Collections,
  s7Variants,
  s7Of,
}: MapViewProps) {
  const located = useMemo(() => items.filter((i) => i.lat !== null && i.lon !== null), [items]);
  const areaBounds = useMemo<[LatLon, LatLon]>(() => [[area.south, area.west], [area.north, area.east]], [area.south, area.west, area.north, area.east]);

  return (
    <MapContainer center={[center.lat, center.lon]} zoom={11} preferCanvas className="h-full w-full" zoomControl>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Rectangle bounds={areaBounds} pathOptions={{ color: "#334155", weight: 1, dashArray: "6 6", fill: false }} interactive={false} />
      <ViewportSync onBoundsChange={onBoundsChange} />
      <S7Overlay collections={s7Collections} variants={s7Variants} />
      <MarkerLayer
        items={located}
        focusId={focusId}
        onFocus={onFocus}
        onDetails={onDetails}
        onToggleFavorite={onToggleFavorite}
        onToggleIgnored={onToggleIgnored}
        isNew={isNew}
        s7Of={s7Of}
      />
    </MapContainer>
  );
}
