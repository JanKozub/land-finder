import { ExternalLink, Eye, EyeOff, Heart, Info } from "lucide-react";
import { memo } from "react";
import type { PropertyDto } from "@shared/schemas";
import type { Source } from "@shared/constants";
import type { S7Proximity } from "@shared/s7";
import { KIND_LABEL, SOURCE_LABEL } from "@/i18n/pl";
import { formatArea, formatKm, formatPln, formatPricePerM2, formatRelative } from "@/lib/format";
import { Badge, Button } from "../ui";
import { cn } from "../ui/cn";
import { S7Badge, s7FarNote } from "./S7Badge";

export interface PropertyCardProps {
  item: PropertyDto;
  isNew: boolean;
  distanceKm: number | null;
  active: boolean;
  onFocus: (id: number) => void;
  onDetails: (id: number) => void;
  onToggleHidden: (item: PropertyDto) => void;
  onToggleFavorite?: (item: PropertyDto) => void;
  compact?: boolean;
  /** Distances to the enabled planned-S7 variants, nearest first (null when unknown or overlay off). */
  s7?: readonly S7Proximity[] | null;
}

export function KindBadge({ kind }: { kind: PropertyDto["kind"] }) {
  return <Badge className={kind === "plot" ? "bg-plot-soft text-plot" : "bg-house-soft text-house"}>{KIND_LABEL[kind]}</Badge>;
}

export function SourceLinks({ links, className }: { links: PropertyDto["links"]; className?: string }) {
  const seen = new Set<string>();
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {links
        .filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)))
        .map((l) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-0.5 rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold hover:bg-slate-100",
              l.active ? "border-slate-300 text-slate-700" : "border-slate-200 text-slate-400 line-through",
            )}
            title={l.active ? "Otwórz ogłoszenie" : "Ogłoszenie już nieaktywne"}
          >
            {SOURCE_LABEL[l.source as Source] ?? l.source}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ))}
    </span>
  );
}

export function FavoriteButton({ favorite, onClick, loading }: { favorite: boolean; onClick: () => void; loading?: boolean }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} loading={loading} title={favorite ? "Usuń z ulubionych" : "Dodaj do ulubionych"} aria-pressed={favorite}>
      <Heart className={cn("h-3.5 w-3.5", favorite ? "fill-pink-500 text-pink-600" : "text-slate-500")} />
    </Button>
  );
}

export const PropertyCard = memo(function PropertyCard({ item, isNew, distanceKm, active, onFocus, onDetails, onToggleHidden, onToggleFavorite, compact, s7 }: PropertyCardProps) {
  const ppm = formatPricePerM2(item.pricePerM2);
  const s7Far = s7FarNote(s7);
  return (
    <article
      className={cn(
        "cursor-pointer rounded-lg border bg-white p-3 shadow-xs transition-colors hover:border-slate-400",
        active ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200",
        (item.hidden || item.ignored) && "opacity-60",
      )}
      onClick={() => onFocus(item.id)}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <KindBadge kind={item.kind} />
        {item.favorite && <Badge className="bg-pink-100 text-pink-700">♥ ulubione</Badge>}
        {isNew && <Badge className="bg-violet-100 text-violet-700">nowe</Badge>}
        {item.hidden && <Badge className="bg-slate-200 text-slate-600">ukryte</Badge>}
        {item.ignored && <Badge className="bg-slate-200 text-slate-600" title="Wszystkie ogłoszenia tej nieruchomości są ignorowane">ignorowane</Badge>}
        {!item.isActive && <Badge className="bg-rose-100 text-rose-700">wygasłe</Badge>}
        {item.locationPrecision !== "exact" && (
          <Badge className="bg-amber-50 text-amber-700" title="Portal podaje tylko przybliżoną lokalizację">
            {item.locationPrecision === "approx" ? "~lokalizacja" : "brak współrzędnych"}
          </Badge>
        )}
        <S7Badge proximity={s7} />
        {item.priceMin !== null && item.price !== null && item.priceMax !== null && item.priceMax > item.price && (
          <Badge className="bg-emerald-100 text-emerald-700" title={`Wcześniej do ${formatPln(item.priceMax)}`}>
            cena spadła
          </Badge>
        )}
        <span className="ml-auto text-[11px] text-slate-500">{formatRelative(item.firstSeenAt)}</span>
      </div>
      <h3 className="line-clamp-2 text-sm font-semibold text-slate-900">{item.title}</h3>
      <p className="mt-1 text-sm">
        <span className="font-bold text-slate-900">{formatPln(item.price)}</span>
        {ppm && <span className="text-slate-500"> · {ppm}</span>}
      </p>
      <p className="text-sm text-slate-700">
        {formatArea(item.areaM2, item.kind)}
        {item.kind === "house" && item.plotAreaM2 !== null && <span className="text-slate-500"> · działka {formatArea(item.plotAreaM2, "plot")}</span>}
      </p>
      <p className="truncate text-xs text-slate-500">
        {[item.city, item.district].filter(Boolean).join(", ") || "lokalizacja nieznana"}
        {distanceKm !== null && ` · ${formatKm(distanceKm)}`}
        {item.isPrivate === true && " · prywatny"}
        {item.isPrivate === false && " · agencja"}
        {s7Far && <span title="Odległość od osi najbliższego włączonego wariantu planowanej S7"> · {s7Far}</span>}
      </p>
      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="primary"
            onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
            title="Otwórz ogłoszenie w nowej karcie"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Otwórz ofertę
          </Button>
          <SourceLinks links={item.links} />
          <span className="ml-auto inline-flex gap-1">
            {onToggleFavorite && <FavoriteButton favorite={item.favorite} onClick={() => onToggleFavorite(item)} />}
            <Button size="sm" variant="ghost" onClick={() => onDetails(item.id)} title="Szczegóły i ogłoszenia">
              <Info className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onToggleHidden(item)} title={item.hidden ? "Przywróć" : "Ukryj — nie interesuje mnie"}>
              {item.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </Button>
          </span>
        </div>
      )}
    </article>
  );
});
