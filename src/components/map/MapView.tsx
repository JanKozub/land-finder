import { Ban, Heart, RotateCcw } from "lucide-react";
import type { LatLngBounds } from "leaflet";
import { memo, useEffect, useMemo, useRef } from "react";
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { PropertyDto } from "@shared/schemas";
import type { S7Proximity, S7Variant } from "@shared/s7";
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
  radiusKm: number;
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

export function MapView({
  items,
  center,
  radiusKm,
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
  const focusedLat = focused?.lat ?? null;
  const focusedLon = focused?.lon ?? null;
  // Stable position object: react-leaflet re-creates the popup whenever `position` changes identity, and a
  // re-created popup fires `remove`, which would close it on every re-render (map move, sort change, drawer).
  const popupPosition = useMemo<[number, number] | null>(() => (focusedLat !== null && focusedLon !== null ? [focusedLat, focusedLon] : null), [focusedLat, focusedLon]);

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
      <Circle center={[center.lat, center.lon]} radius={radiusKm * 1000} pathOptions={{ color: "#334155", weight: 1, dashArray: "6 6", fill: false }} interactive={false} />
      <ViewportSync onBoundsChange={onBoundsChange} />
      <FocusController focusId={focusId} lat={focused?.lat ?? null} lon={focused?.lon ?? null} />
      <S7Overlay collections={s7Collections} variants={s7Variants} />
      {located.map((item) => {
        const isFocused = item.id === focusId;
        const muted = item.hidden || item.ignored;
        const fill = muted ? COLORS.hidden : item.favorite ? COLORS.favorite : !item.isActive ? COLORS.inactive : COLORS[item.kind];
        return (
          <PropertyMarker
            key={item.id}
            id={item.id}
            lat={item.lat!}
            lon={item.lon!}
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
      {focused && popupPosition && (
        <Popup key={focused.id} position={popupPosition} eventHandlers={popupEvents} offset={POPUP_OFFSET}>
          <PopupContent item={focused} s7={s7Of(focused)} onDetails={onDetails} onToggleFavorite={onToggleFavorite} onToggleIgnored={onToggleIgnored} />
        </Popup>
      )}
    </MapContainer>
  );
}
