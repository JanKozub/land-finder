import type { Feature, Point } from "geojson";
import L from "leaflet";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, useMap, useMapEvents } from "react-leaflet";
import type { S7Feature, S7FeatureCollection, S7FeatureProps, S7Kind, S7Variant } from "@shared/s7";
import type { S7Collections } from "@/hooks/useS7";
import { S7_KIND_LABEL } from "@/i18n/pl";
import { S7_COLORS, s7VariantLabel } from "@/lib/s7";

const ATTRIBUTION =
  'Trasa S7: &copy; <a href="https://s7-krakow-myslenice-stes.gddkia.gov.pl/" target="_blank" rel="noopener noreferrer">GDDKiA (STEŚ 2025)</a>';

const LINE_KINDS: readonly S7Kind[] = ["axis", "axisTunnel", "bdi", "bdiTunnel"];
const AREA_KINDS: readonly S7Kind[] = ["bridge", "tunnel", "interchange"];
const EXTENT_KINDS: readonly S7Kind[] = ["extent"];
const POINT_KINDS: readonly S7Kind[] = ["interchangeName"];

/** Zoom level from which the denser layers become readable (zoom 13 ≈ 12 m/px around Kraków). */
const ZOOM_DETAILS = 13;
/**
 * Once shown, the details stay until the map is zoomed out this far: mounting the ~600 bridge, tunnel, interchange and
 * work-extent layers costs about 100 ms, and users flip between zoom 12 and 13 all the time.
 */
const ZOOM_DETAILS_HIDE = 11;
const HOVER_KINDS: readonly S7Kind[] = [...LINE_KINDS, "bridge", "tunnel", "interchange"];
// Kilometre posts ("km") are in the data but not drawn yet.

function styleFeature(feature?: S7Feature): L.PathOptions {
  if (!feature) return {};
  const { variant, kind } = feature.properties;
  const color = S7_COLORS[variant];
  switch (kind) {
    case "axis":
      return { color, weight: 4, opacity: 0.9 };
    case "axisTunnel":
      return { color, weight: 4, opacity: 0.9, dashArray: "8 8" };
    case "bdi":
      return { color, weight: 2.5, opacity: 0.85 };
    case "bdiTunnel":
      return { color, weight: 2.5, opacity: 0.85, dashArray: "6 6" };
    case "extent":
      return { color, weight: 1, opacity: 0.55, fill: false, interactive: false };
    case "bridge":
      return { color, weight: 1, opacity: 0.8, fillColor: color, fillOpacity: 0.3 };
    case "tunnel":
      return { color, weight: 1, opacity: 0.7, dashArray: "4 4", fillColor: color, fillOpacity: 0.12 };
    case "interchange":
      return { color, weight: 1, opacity: 0.8, fillColor: color, fillOpacity: 0.2 };
    case "interchangeName":
      // Clickable dot; clicks must not bubble to the map, which would close an open property popup.
      return { color, weight: 2, opacity: 1, fillColor: "#ffffff", fillOpacity: 1, interactive: true, bubblingMouseEvents: false };
    default:
      return { color, weight: 1, opacity: 0.6, interactive: false };
  }
}

/** Leaflet tooltips take a class name only, so the variant colour is applied when the tooltip opens. */
function paintTooltip(layer: L.Layer, color: string) {
  layer.on("tooltipopen", (e) => {
    const el = e.tooltip.getElement();
    if (el) {
      el.style.color = color;
      el.style.borderColor = color;
    }
  });
}

/** Interchange dots: clicking one shows or hides its name (a standalone tooltip, so it has no hover behaviour). */
function makePointToLayer(map: L.Map) {
  return (feature: Feature<Point, S7FeatureProps>, latlng: L.LatLng): L.Layer => {
    const { variant, name } = feature.properties;
    const marker = L.circleMarker(latlng, { radius: 5 });
    if (!name) return marker;
    const label = L.tooltip({ permanent: true, direction: "top", offset: [0, -7], className: "s7-label", opacity: 0.95, interactive: false }, marker)
      .setLatLng(latlng)
      .setContent(name);
    paintTooltip(marker, S7_COLORS[variant]);
    marker.on("click", () => {
      if (map.hasLayer(label)) map.removeLayer(label);
      else label.addTo(map);
    });
    // The label is its own layer: drop it together with the dot (variant switched off, overlay unmounted).
    marker.on("remove", () => {
      if (map.hasLayer(label)) map.removeLayer(label);
    });
    return marker;
  };
}

function onEachFeature(feature: S7Feature, layer: L.Layer) {
  const { variant, kind } = feature.properties;
  if (!HOVER_KINDS.includes(kind)) return;
  layer.bindTooltip(`${s7VariantLabel(variant)} · ${S7_KIND_LABEL[kind]}`, { sticky: true, direction: "top", className: "s7-tip", opacity: 0.95 });
  paintTooltip(layer, S7_COLORS[variant]);
}

/** Whether the detail layers are shown, with hysteresis between ZOOM_DETAILS_HIDE and ZOOM_DETAILS. */
function useShowDetails(): boolean {
  const map = useMap();
  const [show, setShow] = useState(() => map.getZoom() >= ZOOM_DETAILS);
  useMapEvents({
    zoomend: () => {
      const zoom = map.getZoom();
      setShow((current) => (current ? zoom > ZOOM_DETAILS_HIDE : zoom >= ZOOM_DETAILS));
    },
  });
  return show;
}

/**
 * One GeoJSON layer group. It shares the canvas with the property markers (so hover tooltips work) and is
 * sent to the back right after mounting so the markers always stay on top.
 */
function S7Group({ data }: { data: S7FeatureCollection }) {
  const map = useMap();
  const ref = useRef<L.GeoJSON>(null);
  const pointToLayer = useMemo(() => makePointToLayer(map), [map]);
  useEffect(() => {
    ref.current?.bringToBack();
  }, []);
  return <GeoJSON ref={ref} data={data} style={styleFeature} pointToLayer={pointToLayer} onEachFeature={onEachFeature} attribution={ATTRIBUTION} />;
}

interface Groups {
  points: S7FeatureCollection;
  lines: S7FeatureCollection;
  areas: S7FeatureCollection;
  extent: S7FeatureCollection;
}

const groupCache = new WeakMap<S7FeatureCollection, Groups>();

function splitGroups(fc: S7FeatureCollection): Groups {
  let groups = groupCache.get(fc);
  if (!groups) {
    const pick = (kinds: readonly S7Kind[]): S7FeatureCollection => ({
      type: "FeatureCollection",
      features: fc.features.filter((f) => kinds.includes(f.properties.kind)),
    });
    groups = { points: pick(POINT_KINDS), lines: pick(LINE_KINDS), areas: pick(AREA_KINDS), extent: pick(EXTENT_KINDS) };
    groupCache.set(fc, groups);
  }
  return groups;
}

export interface S7OverlayProps {
  collections: S7Collections;
  variants: readonly S7Variant[];
}

/**
 * Planned S7 Kraków–Myślenice route variants; details (bridges, tunnels, work extent) appear when zoomed in.
 * Every group sends itself to the back on mount, so groups are listed front-to-back: interchange dots must stay
 * clickable above the axis lines, and the areas/extent belong underneath everything.
 */
export function S7Overlay({ collections, variants }: S7OverlayProps) {
  const showDetails = useShowDetails();
  return (
    <>
      {variants.map((variant) => {
        const fc = collections[variant];
        if (!fc) return null;
        const groups = splitGroups(fc);
        return (
          <Fragment key={variant}>
            {groups.points.features.length > 0 && <S7Group data={groups.points} />}
            <S7Group data={groups.lines} />
            {showDetails && groups.areas.features.length > 0 && <S7Group data={groups.areas} />}
            {showDetails && groups.extent.features.length > 0 && <S7Group data={groups.extent} />}
          </Fragment>
        );
      })}
    </>
  );
}
