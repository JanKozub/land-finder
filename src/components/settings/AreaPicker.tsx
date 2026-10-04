import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, Rectangle, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Area } from "@shared/area";

function Clicks({ onCorner }: { onCorner: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onCorner(Number(e.latlng.lat.toFixed(5)), Number(e.latlng.lng.toFixed(5))) });
  return null;
}

/** Fits the map to the rectangle whenever it changes from outside (typed bounds, saved settings). */
function FitArea({ area }: { area: Area }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(
      [
        [area.south, area.west],
        [area.north, area.east],
      ],
      { padding: [24, 24], animate: false },
    );
  }, [map, area.south, area.west, area.north, area.east]);
  return null;
}

/**
 * Draws the search rectangle: click one corner, then the opposite one. The map starts fitted to the current area.
 */
export function AreaPicker({ area, onChange }: { area: Area; onChange: (area: Area) => void }) {
  const [pending, setPending] = useState<[number, number] | null>(null);
  const onCorner = (lat: number, lon: number) => {
    if (!pending) {
      setPending([lat, lon]);
      return;
    }
    const [lat0, lon0] = pending;
    setPending(null);
    if (Math.abs(lat - lat0) < 0.002 || Math.abs(lon - lon0) < 0.002) return; // accidental double click
    onChange({ south: Math.min(lat0, lat), north: Math.max(lat0, lat), west: Math.min(lon0, lon), east: Math.max(lon0, lon) });
  };
  return (
    <div className="space-y-1">
      <div className="h-80 overflow-hidden rounded-md border border-slate-200">
        <MapContainer center={[(area.south + area.north) / 2, (area.west + area.east) / 2]} zoom={10} className="h-full w-full">
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitArea area={area} />
          <Clicks onCorner={onCorner} />
          <Rectangle
            bounds={[
              [area.south, area.west],
              [area.north, area.east],
            ]}
            pathOptions={{ color: "#0f172a", weight: 2, dashArray: pending ? "4 4" : undefined, fillOpacity: 0.05 }}
            interactive={false}
          />
          {pending && <CircleMarker center={pending} radius={6} pathOptions={{ color: "#dc2626", fillColor: "#dc2626", fillOpacity: 1 }} />}
        </MapContainer>
      </div>
      <p className="text-xs text-slate-500">
        {pending ? "Kliknij przeciwległy róg nowego prostokąta." : "Kliknij na mapie pierwszy róg, potem przeciwległy, aby narysować nowy obszar."}
      </p>
    </div>
  );
}
