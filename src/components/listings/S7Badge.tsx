import { S7_NEAR_M, s7Level, type S7Proximity } from "@shared/s7";
import { formatMeters } from "@/lib/format";
import { S7_COLORS, s7VariantLabel } from "@/lib/s7";
import { Badge } from "../ui";
import { cn } from "../ui/cn";

function roadSuffix(p: S7Proximity): string {
  return p.road === "BDI" ? " (BDI)" : "";
}

export function s7Title(proximity: readonly S7Proximity[]): string {
  return `Odległość od osi planowanej S7: ${proximity.map((p) => `wariant ${p.variant}${roadSuffix(p)} – ${formatMeters(p.meters)}`).join(", ")}`;
}

/** Badge for a property on or near the nearest enabled S7 variant; nothing for properties further away. */
export function S7Badge({ proximity }: { proximity: readonly S7Proximity[] | null | undefined }) {
  const nearest = proximity?.[0];
  if (!nearest || !proximity) return null;
  const level = s7Level(nearest.meters);
  if (level === "far") return null;
  const color = S7_COLORS[nearest.variant];
  const others = proximity.filter((p) => p !== nearest && p.meters <= S7_NEAR_M).length;
  const text = `S7 ${nearest.variant}${nearest.road === "BDI" ? "/BDI" : ""} · ${formatMeters(nearest.meters)}${others ? ` +${others}` : ""}`;
  const title = `${level === "on" ? "Na trasie" : "W pobliżu"} wariantu ${nearest.variant}. ${s7Title(proximity)}`;
  return level === "on" ? (
    <Badge className="normal-case text-white" style={{ backgroundColor: color }} title={title}>
      {text}
    </Badge>
  ) : (
    <Badge className="normal-case" style={{ color, backgroundColor: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}66` }} title={title}>
      {text}
    </Badge>
  );
}

/** Quiet one-liner for the card meta row when the property is far from every variant. */
export function s7FarNote(proximity: readonly S7Proximity[] | null | undefined): string | null {
  const nearest = proximity?.[0];
  if (!nearest || s7Level(nearest.meters) !== "far") return null;
  return `S7: ${formatMeters(nearest.meters)} (${nearest.variant})`;
}

/** Distances to every enabled variant as coloured chips, nearest first. */
export function S7Distances({ proximity, className }: { proximity: readonly S7Proximity[]; className?: string }) {
  if (!proximity.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1", className)}>
      {proximity.map((p) => {
        const color = S7_COLORS[p.variant];
        const level = s7Level(p.meters);
        return (
          <li
            key={p.variant}
            className={cn("inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium", level === "on" && "text-white")}
            style={level === "on" ? { backgroundColor: color, borderColor: color } : { color, borderColor: `${color}99` }}
            title={`${s7VariantLabel(p.variant)}${roadSuffix(p)}: ${formatMeters(p.meters)} od osi trasy`}
          >
            <b>{p.variant}</b>
            {p.road === "BDI" && <span className="opacity-80">BDI</span>}
            {formatMeters(p.meters)}
          </li>
        );
      })}
    </ul>
  );
}
