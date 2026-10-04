import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { KINDS, SOURCES } from "@shared/constants";
import type { Filters } from "@shared/schemas";
import { KIND_LABEL_PLURAL, SOURCE_LABEL } from "@/i18n/pl";
import { Button, Select, Switch } from "../ui";
import { NumberInput } from "./NumberInput";

export interface FiltersPanelProps {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
  onlyNew: boolean;
  setOnlyNew: (v: boolean) => void;
  hasLastVisit: boolean;
  /** Extra controls rendered below the switches (e.g. the planned-S7 overlay). */
  extra?: ReactNode;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FiltersPanel({ filters, onChange, onReset, onlyNew, setOnlyNew, hasLastVisit, extra }: FiltersPanelProps) {
  return (
    <div className="space-y-3 border-b border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {KINDS.map((k) => (
          <label key={k} className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-slate-900"
              checked={filters.kinds.includes(k)}
              onChange={() => {
                const next = toggle(filters.kinds, k);
                if (next.length) onChange({ kinds: next });
              }}
            />
            <span className={k === "plot" ? "text-plot font-medium" : "text-house font-medium"}>{KIND_LABEL_PLURAL[k]}</span>
          </label>
        ))}
        <span className="mx-1 text-slate-300">|</span>
        {SOURCES.map((s) => (
          <label key={s} className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-slate-900"
              checked={filters.sources.includes(s)}
              onChange={() => {
                const next = toggle(filters.sources, s);
                if (next.length) onChange({ sources: next });
              }}
            />
            {SOURCE_LABEL[s]}
          </label>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onReset} title="Wyczyść filtry">
          <RotateCcw className="h-3.5 w-3.5" /> Wyczyść
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberInput value={filters.priceMin} onCommit={(v) => onChange({ priceMin: v })} placeholder="Cena od" suffix="zł" min={0} />
        <NumberInput value={filters.priceMax} onCommit={(v) => onChange({ priceMax: v })} placeholder="Cena do" suffix="zł" min={0} />
        <NumberInput value={filters.areaMin} onCommit={(v) => onChange({ areaMin: v })} placeholder="Pow. od" suffix="m²" min={0} />
        <NumberInput value={filters.areaMax} onCommit={(v) => onChange({ areaMax: v })} placeholder="Pow. do" suffix="m²" min={0} />
        <NumberInput value={filters.pricePerM2Max} onCommit={(v) => onChange({ pricePerM2Max: v })} placeholder="Max zł/m²" suffix="zł/m²" min={0} />
        <NumberInput value={filters.distanceKm} onCommit={(v) => onChange({ distanceKm: v })} placeholder="Max odległość" suffix="km" min={0} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Select value={filters.owner} onChange={(e) => onChange({ owner: e.target.value as Filters["owner"] })}>
          <option value="all">Wszyscy sprzedający</option>
          <option value="private">Tylko prywatni</option>
          <option value="agency">Tylko agencje</option>
        </Select>
        <Select
          value={filters.addedWithinDays ?? ""}
          onChange={(e) => onChange({ addedWithinDays: e.target.value === "" ? null : Number(e.target.value) })}
        >
          <option value="">Dodane kiedykolwiek</option>
          <option value="1">Ostatnie 24 h</option>
          <option value="3">Ostatnie 3 dni</option>
          <option value="7">Ostatnie 7 dni</option>
          <option value="30">Ostatnie 30 dni</option>
        </Select>
        <Select value={filters.hidden} onChange={(e) => onChange({ hidden: e.target.value as Filters["hidden"] })}>
          <option value="exclude">Bez ukrytych</option>
          <option value="include">Pokaż też ukryte</option>
          <option value="only">Tylko ukryte</option>
        </Select>
        <Select value={filters.active} onChange={(e) => onChange({ active: e.target.value as Filters["active"] })}>
          <option value="only">Tylko aktualne</option>
          <option value="include">Pokaż też wygasłe</option>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Switch
          checked={onlyNew}
          onChange={setOnlyNew}
          disabled={!hasLastVisit}
          label={hasLastVisit ? "Tylko nowe od ostatniej wizyty" : "Tylko nowe od ostatniej wizyty (pierwsza wizyta)"}
        />
        <Switch
          checked={filters.ignored !== "exclude"}
          onChange={(v) => onChange({ ignored: v ? "include" : "exclude" })}
          label="Pokaż ignorowane ogłoszenia"
        />
        <Switch checked={filters.favorites === "only"} onChange={(v) => onChange({ favorites: v ? "only" : "all" })} label="Tylko ulubione" />
      </div>
      {extra}
    </div>
  );
}
