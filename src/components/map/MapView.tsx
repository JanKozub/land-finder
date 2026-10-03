import { Ban, RotateCcw, Star } from "lucide-react";
import type { LatLngBounds } from "leaflet";
import { memo, useEffect, useMemo, useRef } from "react";
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { PropertyDto } from "@shared/schemas";
import { formatArea, formatPln, formatPricePerM2 } from "@/lib/format";
import type { Bounds } from "@/lib/geo";
import { Button } from "../ui";
import { cn } from "../ui/cn";
import { KindBadge, SourceLinks } from "../listings/PropertyCard";

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
}

const COLORS = { plot: "#38bdf8", house: "#d97706", hidden: "#94a3b8", inactive: "#e11d48", favorite: "#ca8a04", focus: "#0f172a" } as const;

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
  onDetails,
  onToggleFavorite,
  onToggleIgnored,
}: {
  item: PropertyDto;
  onDetails: (id: number) => void;
  onToggleFavorite: (item: PropertyDto) => void;
  onToggleIgnored: (item: PropertyDto) => void;
}) {
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <KindBadge kind={item.kind} />
        {item.favorite && <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">★ ulubione</span>}
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
          <Star className={cn("h-3.5 w-3.5", item.favorite ? "fill-amber-400 text-amber-500" : "")} />
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

export function MapView({ items, center, radiusKm, focusId, onFocus, onDetails, onBoundsChange, isNew, onToggleFavorite, onToggleIgnored }: MapViewProps) {
  const focused = useMemo(() => items.find((i) => i.id === focusId) ?? null, [items, focusId]);
  const located = useMemo(() => items.filter((i) => i.lat !== null && i.lon !== null), [items]);
  const focusIdRef = useRef(focusId);
  focusIdRef.current = focusId;

  // A single popup for the focused property; closing it (× or map click) clears the focus.
  const popupEvents = useMemo(
    () => ({
      remove: () => {
        if (focusIdRef.current !== null) onFocus(null);
      },
    }),
    [onFocus],
  );

  return (
    <MapContainer center={[center.lat, center.lon]} zoom={11} preferCanvas className="h-full w-full" zoomControl>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Circle center={[center.lat, center.lon]} radius={radiusKm * 1000} pathOptions={{ color: "#334155", weight: 1, dashArray: "6 6", fill: false }} interactive={false} />
      <ViewportSync onBoundsChange={onBoundsChange} />
      <FocusController focusId={focusId} lat={focused?.lat ?? null} lon={focused?.lon ?? null} />
      {located.map((item) => {
        const isFocused = item.id === focusId;
        const muted = item.hidden || item.ignored;
        const fill = muted ? COLORS.hidden : !item.isActive ? COLORS.inactive : COLORS[item.kind];
        return (
          <PropertyMarker
            key={item.id}
            id={item.id}
            lat={item.lat!}
            lon={item.lon!}
            radius={isFocused ? 10 : isNew(item) ? 8 : 6}
            stroke={isFocused ? COLORS.focus : item.favorite ? COLORS.favorite : fill}
            weight={isFocused || item.favorite ? 3 : item.locationPrecision === "approx" ? 1.5 : 1}
            dashed={item.locationPrecision === "approx"}
            fill={fill}
            fillOpacity={muted ? 0.4 : 0.85}
            onFocus={onFocus}
          />
        );
      })}
      {focused && focused.lat !== null && focused.lon !== null && (
        <Popup position={[focused.lat, focused.lon]} eventHandlers={popupEvents} offset={[0, -6]}>
          <PopupContent item={focused} onDetails={onDetails} onToggleFavorite={onToggleFavorite} onToggleIgnored={onToggleIgnored} />
        </Popup>
      )}
    </MapContainer>
  );
}
