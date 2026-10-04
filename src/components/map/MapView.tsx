import { Ban, Heart, RotateCcw } from "lucide-react";
import type { LatLngBounds } from "leaflet";
import type { Popup as LeafletPopup } from "leaflet";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, Rectangle, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Area } from "@shared/area";
import type { PropertyDto } from "@shared/schemas";
import type { S7Proximity, S7Variant } from "@shared/s7";
import { spreadOverlapping } from "@shared/spread";
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

const POPUP_OFFSET: [number, number] = [0, -6];

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
}

/** Memoized so that map moves and list updates do not touch hundreds of Leaflet layers. */
const PropertyMarker = memo(function PropertyMarker(p: MarkerProps) {
  const pathOptions = useMemo(
    () => ({ color: p.stroke, weight: p.weight, dashArray: p.dashed ? "3 3" : undefined, fillColor: p.fill, fillOpacity: p.fillOpacity }),
    [p.stroke, p.weight, p.dashed, p.fill, p.fillOpacity],
  );
  const eventHandlers = useMemo(() => ({ click: () => p.onFocus(p.id) }), [p.onFocus, p.id]);
  return <CircleMarker center={[p.lat, p.lon]} radius={p.radius} pathOptions={pathOptions} eventHandlers={eventHandlers} />;
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

type LatLon = [number, number];

const LEG_STYLE = { color: "#64748b", weight: 1, opacity: 0.55 } as const;

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

interface MarkerLayerProps {
  items: PropertyDto[];
  focused: PropertyDto | null;
  focusId: number | null;
  onFocus: (id: number | null) => void;
  isNew: (item: PropertyDto) => boolean;
  popupEvents: { remove: () => void };
  popupContent: React.ReactNode;
}

/** Property dots, the overlap spreading, the focus controller and the single popup (all need the map instance). */
function MarkerLayer({ items, focused, focusId, onFocus, isNew, popupEvents, popupContent }: MarkerLayerProps) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  // Recomputed per zoom level: the spread is defined in pixels.
  const spread = useMemo(() => spreadOverlapping(map, items), [map, items, zoom]);
  const focusedPos: LatLon | null = focused && focused.lat !== null && focused.lon !== null ? (spread.positions.get(focused.id) ?? [focused.lat, focused.lon]) : null;

  return (
    <>
      {spread.legs.map((groupLegs, i) => (
        <Polyline key={`legs-${i}-${groupLegs[0]?.[0]?.join(",")}`} positions={groupLegs} pathOptions={LEG_STYLE} interactive={false} />
      ))}
      <FocusController focusId={focusId} lat={focusedPos?.[0] ?? null} lon={focusedPos?.[1] ?? null} />
      {items.map((item) => {
        const isFocused = item.id === focusId;
        const muted = item.hidden || item.ignored;
        const fill = muted ? COLORS.hidden : item.favorite ? COLORS.favorite : !item.isActive ? COLORS.inactive : COLORS[item.kind];
        const pos = spread.positions.get(item.id);
        return (
          <PropertyMarker
            key={item.id}
            id={item.id}
            lat={pos ? pos[0] : item.lat!}
            lon={pos ? pos[1] : item.lon!}
            radius={isFocused ? 10 : item.favorite || isNew(item) ? 8 : 6}
            stroke={isFocused ? COLORS.focus : item.favorite && !muted ? COLORS.favoriteStroke : fill}
            weight={isFocused ? 3 : item.favorite && !muted ? 2 : item.locationPrecision === "approx" ? 1.5 : 1}
            dashed={item.locationPrecision === "approx"}
            fill={fill}
            fillOpacity={muted ? 0.4 : 0.85}
            onFocus={onFocus}
          />
        );
      })}
      {focused && focusedPos && (
        <FocusedPopup key={focused.id} pos={focusedPos} events={popupEvents}>
          {popupContent}
        </FocusedPopup>
      )}
    </>
  );
}

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
  const focused = useMemo(() => items.find((i) => i.id === focusId) ?? null, [items, focusId]);
  const located = useMemo(() => items.filter((i) => i.lat !== null && i.lon !== null), [items]);
  const focusIdRef = useRef(focusId);
  focusIdRef.current = focusId;
  const focusedId = focused?.id ?? null;

  // A single popup for the focused property; closing it (× or map click) clears the focus. The handler is bound to
  // the popup's own property, so swapping the focus to another property (which removes this popup) keeps the new one.
  const popupEvents = useMemo(
    () => ({
      remove: () => {
        if (focusedId !== null && focusIdRef.current === focusedId) onFocus(null);
      },
    }),
    [focusedId, onFocus],
  );

  return (
    <MapContainer center={[center.lat, center.lon]} zoom={11} preferCanvas className="h-full w-full" zoomControl>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Rectangle
        bounds={[
          [area.south, area.west],
          [area.north, area.east],
        ]}
        pathOptions={{ color: "#334155", weight: 1, dashArray: "6 6", fill: false }}
        interactive={false}
      />
      <ViewportSync onBoundsChange={onBoundsChange} />
      <FocusController focusId={focusId} lat={focused?.lat ?? null} lon={focused?.lon ?? null} />
      <S7Overlay collections={s7Collections} variants={s7Variants} />
      <MarkerLayer
        items={located}
        focused={focused}
        focusId={focusId}
        onFocus={onFocus}
        isNew={isNew}
        popupEvents={popupEvents}
        popupContent={focused ? <PopupContent item={focused} s7={s7Of(focused)} onDetails={onDetails} onToggleFavorite={onToggleFavorite} onToggleIgnored={onToggleIgnored} /> : null}
      />
    </MapContainer>
  );
}
