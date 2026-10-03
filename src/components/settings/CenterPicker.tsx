import { Circle, CircleMarker, MapContainer, TileLayer, useMapEvents } from "react-leaflet";

function ClickHandler({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onPick(Number(e.latlng.lat.toFixed(5)), Number(e.latlng.lng.toFixed(5))) });
  return null;
}

export function CenterPicker({ center, radiusKm, onPick }: { center: { lat: number; lon: number }; radiusKm: number; onPick: (lat: number, lon: number) => void }) {
  return (
    <div className="h-72 overflow-hidden rounded-md border border-slate-200">
      <MapContainer center={[center.lat, center.lon]} zoom={10} className="h-full w-full" key={`${center.lat.toFixed(2)}-${center.lon.toFixed(2)}`}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ClickHandler onPick={onPick} />
        <Circle center={[center.lat, center.lon]} radius={radiusKm * 1000} pathOptions={{ color: "#334155", weight: 1, dashArray: "6 6", fill: false }} />
        <CircleMarker center={[center.lat, center.lon]} radius={7} pathOptions={{ color: "#0f172a", fillColor: "#0f172a", fillOpacity: 1 }} />
      </MapContainer>
    </div>
  );
}
