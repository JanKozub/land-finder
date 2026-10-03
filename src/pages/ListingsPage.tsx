import { ArrowDown, ArrowUp, Ban, ChevronLeft, ChevronRight, Download, ExternalLink, MapPin, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { KINDS, SOURCES, type Kind, type Source } from "@shared/constants";
import { listingsQueryToParams, parseListingsQuery, type ListingSortKey, type ListingTableRowDto, type ListingsQuery } from "@shared/schemas";
import { useIgnoreListing, useListingsTable } from "@/api/hooks";
import { KindBadge } from "@/components/listings/PropertyCard";
import { Badge, Button, ErrorText, Input, Select } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { KIND_LABEL, KIND_LABEL_PLURAL, SOURCE_LABEL } from "@/i18n/pl";
import { formatArea, formatDate, formatDateTime, formatPln, formatPricePerM2, formatRelative } from "@/lib/format";

interface Column {
  key: string;
  label: string;
  sort?: ListingSortKey;
  align?: "right";
  className?: string;
}

const COLUMNS: Column[] = [
  { key: "id", label: "ID", sort: undefined, className: "w-16" },
  { key: "source", label: "Źródło", sort: "source" },
  { key: "kind", label: "Rodzaj", sort: "kind" },
  { key: "title", label: "Tytuł", sort: "title", className: "min-w-[18rem]" },
  { key: "price", label: "Cena", sort: "price", align: "right" },
  { key: "ppm2", label: "zł/m²", sort: "pricePerM2", align: "right" },
  { key: "area", label: "Powierzchnia", sort: "areaM2", align: "right" },
  { key: "plot", label: "Działka", sort: "plotAreaM2", align: "right" },
  { key: "city", label: "Miejscowość", sort: "city" },
  { key: "seller", label: "Sprzedający" },
  { key: "created", label: "Dodano", sort: "sourceCreatedAt" },
  { key: "seen", label: "Widziane", sort: "lastSeenAt" },
  { key: "status", label: "Status" },
  { key: "location", label: "Lokalizacja" },
  { key: "actions", label: "" },
];

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows: ListingTableRowDto[]): void {
  const header = ["id", "zrodlo", "rodzaj", "tytul", "cena", "zl_m2", "powierzchnia_m2", "dzialka_m2", "miejscowosc", "dzielnica", "sprzedajacy", "prywatny", "dodano", "widziane", "aktywne", "ignorowane", "lat", "lon", "lokalizacja", "nieruchomosc_id", "url"];
  const lines = rows.map((r) =>
    [
      r.id,
      SOURCE_LABEL[r.source as Source] ?? r.source,
      KIND_LABEL[r.kind],
      r.title,
      r.price,
      r.pricePerM2,
      r.areaM2,
      r.plotAreaM2,
      r.city,
      r.district,
      r.advertiserName,
      r.isPrivate === null ? "" : r.isPrivate ? "tak" : "nie",
      r.sourceCreatedAt ?? r.firstSeenAt,
      r.lastSeenAt,
      r.isActive ? "tak" : "nie",
      r.ignored ? "tak" : "nie",
      r.lat,
      r.lon,
      r.locationPrecision,
      r.propertyId,
      r.url,
    ]
      .map(csvEscape)
      .join(";"),
  );
  const blob = new Blob([`﻿${[header.join(";"), ...lines].join("\n")}`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `oferty-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ListingsPage() {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseListingsQuery(Object.fromEntries(params)), [params]);
  const [search, setSearch] = useState(query.q);
  useEffect(() => setSearch(query.q), [query.q]);
  const data = useListingsTable(query);
  const ignore = useIgnoreListing();

  const update = (patch: Partial<ListingsQuery>) => {
    const next = { ...query, ...patch };
    if (!("page" in patch)) next.page = 1;
    setParams(listingsQueryToParams(next), { replace: true });
  };
  const toggleSort = (key: ListingSortKey) => {
    if (query.sort === key) update({ dir: query.dir === "asc" ? "desc" : "asc" });
    else update({ sort: key, dir: key === "title" || key === "city" || key === "source" || key === "kind" ? "asc" : "desc" });
  };

  const rows = data.data?.rows ?? [];
  const total = data.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / query.pageSize));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 text-sm">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <Input
            className="pl-8"
            placeholder="Szukaj w tytule, miejscowości lub ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && update({ q: search.trim() })}
            onBlur={() => search.trim() !== query.q && update({ q: search.trim() })}
          />
        </div>
        <Select className="w-auto" value={query.source ?? ""} onChange={(e) => update({ source: (e.target.value || undefined) as Source | undefined })}>
          <option value="">Wszystkie źródła</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={query.kind ?? ""} onChange={(e) => update({ kind: (e.target.value || undefined) as Kind | undefined })}>
          <option value="">Działki i domy</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL_PLURAL[k]}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={query.status} onChange={(e) => update({ status: e.target.value as ListingsQuery["status"] })}>
          <option value="all">Aktywne i wygasłe</option>
          <option value="active">Tylko aktywne</option>
          <option value="inactive">Tylko wygasłe</option>
        </Select>
        <Select className="w-auto" value={query.ignored} onChange={(e) => update({ ignored: e.target.value as ListingsQuery["ignored"] })}>
          <option value="all">Ignorowane: pokazuj</option>
          <option value="hide">Ignorowane: ukryj</option>
          <option value="only">Tylko ignorowane</option>
        </Select>
        <span className="ml-auto text-slate-600">
          {data.isLoading ? "Ładowanie…" : `${total} ogłoszeń`}
          {data.isFetching && !data.isLoading && <span className="ml-2 animate-pulse text-slate-400">odświeżanie…</span>}
        </span>
        <Button size="sm" onClick={() => exportCsv(rows)} disabled={rows.length === 0} title="Eksportuje bieżącą stronę tabeli">
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
      </div>
      <ErrorText error={data.error} />

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-600">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn("border-b border-slate-200 px-2 py-2 font-semibold whitespace-nowrap", col.align === "right" && "text-right", col.className, col.sort && "cursor-pointer select-none hover:text-slate-900")}
                  onClick={col.sort ? () => toggleSort(col.sort!) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sort && query.sort === col.sort && (query.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-b border-slate-100 hover:bg-slate-50", (!r.isActive || r.ignored) && "text-slate-400", (r.propertyHidden || r.ignored) && "bg-slate-50")}>
                <td className="px-2 py-1.5 text-slate-500">{r.id}</td>
                <td className="px-2 py-1.5">
                  <Badge className="bg-slate-100 text-slate-700">{SOURCE_LABEL[r.source as Source] ?? r.source}</Badge>
                </td>
                <td className="px-2 py-1.5">
                  <KindBadge kind={r.kind} />
                </td>
                <td className="px-2 py-1.5">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-900 hover:underline" title={r.url}>
                    {r.title}
                  </a>
                  <div className="text-[11px] text-slate-400">#{r.sourceId}</div>
                </td>
                <td className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                  {formatPln(r.price)}
                  {r.priceNegotiable && <span className="text-[10px] font-normal text-slate-400"> neg.</span>}
                </td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatPricePerM2(r.pricePerM2) ?? "—"}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatArea(r.areaM2, r.kind)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">{r.plotAreaM2 === null ? "—" : formatArea(r.plotAreaM2, "plot")}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {r.city ?? "—"}
                  {r.district && <span className="text-slate-400">, {r.district}</span>}
                </td>
                <td className="max-w-[10rem] truncate px-2 py-1.5" title={r.advertiserName ?? ""}>
                  {r.isPrivate === true ? "prywatny" : r.isPrivate === false ? "agencja" : "—"}
                  {r.advertiserName && <span className="text-slate-400"> · {r.advertiserName}</span>}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap" title={formatDateTime(r.sourceCreatedAt ?? r.firstSeenAt)}>
                  {formatDate(r.sourceCreatedAt ?? r.firstSeenAt)}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap" title={formatDateTime(r.lastSeenAt)}>
                  {formatRelative(r.lastSeenAt)}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {r.isActive ? <Badge className="bg-emerald-100 text-emerald-700">aktywne</Badge> : <Badge className="bg-rose-100 text-rose-700">wygasłe</Badge>}
                  {r.propertyHidden && <Badge className="ml-1 bg-slate-200 text-slate-600">ukryte</Badge>}
                  {r.ignored && <Badge className="ml-1 bg-slate-200 text-slate-600">ignorowane</Badge>}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {r.locationPrecision === "exact" ? "dokładna" : r.locationPrecision === "approx" ? "przybliżona" : "brak"}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2 text-[11px] font-medium text-white hover:bg-slate-700"
                    >
                      <ExternalLink className="h-3 w-3" /> Otwórz
                    </a>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      loading={ignore.isPending && ignore.variables?.id === r.id}
                      onClick={() => ignore.mutate({ id: r.id, ignored: !r.ignored })}
                      title={r.ignored ? "Przywróć ogłoszenie" : "Ignoruj to ogłoszenie (znika z mapy)"}
                    >
                      {r.ignored ? <RotateCcw className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                      {r.ignored ? "Przywróć" : "Ignoruj"}
                    </Button>
                    {r.propertyId !== null && (
                      <Link
                        to={`/?focus=${r.propertyId}&hidden=include&ignored=include&active=include`}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-300 px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                        title={`Pokaż nieruchomość #${r.propertyId} na mapie`}
                      >
                        <MapPin className="h-3 w-3" /> Mapa
                      </Link>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !data.isLoading && (
              <tr>
                <td colSpan={COLUMNS.length} className="p-8 text-center text-sm text-slate-500">
                  Brak ogłoszeń spełniających warunki.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-2 text-sm">
        <Select className="w-auto" value={query.pageSize} onChange={(e) => update({ pageSize: Number(e.target.value) })}>
          {[50, 100, 200, 500].map((n) => (
            <option key={n} value={n}>
              {n} na stronę
            </option>
          ))}
        </Select>
        <span className="ml-auto text-slate-600">
          Strona {query.page} z {pages}
        </span>
        <Button size="sm" onClick={() => update({ page: query.page - 1 })} disabled={query.page <= 1}>
          <ChevronLeft className="h-4 w-4" /> Poprzednia
        </Button>
        <Button size="sm" onClick={() => update({ page: query.page + 1 })} disabled={query.page >= pages}>
          Następna <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
