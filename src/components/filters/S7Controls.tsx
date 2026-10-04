import { S7_VARIANTS, type S7Variant } from "@shared/s7";
import { S7_COLORS, S7_FILTER_OPTIONS, parseS7Filter, serializeS7Filter, s7VariantLabel, type S7Filter } from "@/lib/s7";
import { Button, Select, Spinner } from "../ui";
import { cn } from "../ui/cn";

export interface S7ControlsProps {
  variants: readonly S7Variant[];
  setVariants: (variants: S7Variant[]) => void;
  filter: S7Filter | null;
  setFilter: (filter: S7Filter | null) => void;
  loading: boolean;
  error: Error | null;
}

/** Toggles for the planned S7 route variants shown on the map plus a proximity filter. */
export function S7Controls({ variants, setVariants, filter, setFilter, loading, error }: S7ControlsProps) {
  const allOn = variants.length === S7_VARIANTS.length;
  return (
    <div className="space-y-1.5 border-t border-slate-200 pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="text-xs font-semibold text-slate-700"
          title="Planowana droga ekspresowa S7 Kraków–Myślenice: warianty A–F ze Studium techniczno-ekonomiczno-środowiskowego GDDKiA (2025)"
        >
          Planowana S7
        </span>
        {S7_VARIANTS.map((v) => {
          const on = variants.includes(v);
          const color = S7_COLORS[v];
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              title={`${s7VariantLabel(v)} – ${on ? "ukryj" : "pokaż"}`}
              onClick={() => setVariants(on ? variants.filter((x) => x !== v) : [...variants, v])}
              className={cn("h-6 w-7 rounded-md border text-xs font-bold transition-colors", on ? "text-white" : "bg-white hover:bg-slate-50")}
              style={on ? { backgroundColor: color, borderColor: color } : { color, borderColor: color }}
            >
              {v}
            </button>
          );
        })}
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setVariants(allOn ? [] : [...S7_VARIANTS])}>
          {allOn ? "ukryj wszystkie" : "wszystkie"}
        </Button>
        {loading && <Spinner className="h-3.5 w-3.5" />}
      </div>
      <Select className="h-8 text-xs" value={serializeS7Filter(filter) ?? ""} onChange={(e) => setFilter(parseS7Filter(e.target.value))} disabled={variants.length === 0}>
        {S7_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {error && <p className="text-[11px] text-rose-600">{error.message}</p>}
    </div>
  );
}
