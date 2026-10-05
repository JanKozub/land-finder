import { Ban, Download, GitMerge, RefreshCw, Search, Stethoscope, Unlock } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { KINDS, type Kind, type Source } from "@shared/constants";
import type { SourceTotals } from "@shared/schemas";
import { api, type SourceProbe } from "@/api/client";
import { queryKeys, useRuns, useScrapeStatus } from "@/api/hooks";
import { Badge, Button, Card, ErrorText } from "@/components/ui";
import { useScrapeLoop } from "@/hooks/useScrapeLoop";
import { JOB_STATUS_LABEL, KIND_LABEL_PLURAL, MODE_LABEL, RUN_STATUS_LABEL, SOURCE_LABEL, TRIGGER_LABEL } from "@/i18n/pl";
import { formatDateTime, formatRelative } from "@/lib/format";

/** "mamy X z Y" per kind: our active listings vs. the totals the portal reported for the configured query. */
function Coverage({ have, totals }: { have: Partial<Record<Kind, number>> | undefined; totals: SourceTotals | undefined }) {
  const parts = KINDS.map((kind) => {
    const reported = totals?.[kind] ? Object.values(totals[kind]!).reduce((sum, t) => sum + t.total, 0) : null;
    const ours = have?.[kind] ?? 0;
    if (reported === null && ours === 0) return null;
    const pct = reported ? Math.min(100, Math.round((ours / reported) * 100)) : null;
    return (
      <span
        key={kind}
        className={pct !== null && pct < 50 ? "text-amber-700" : "text-slate-600"}
        title={
          reported === null
            ? "Portal nie podał liczby wyników"
            : "W bazie / wyniki zgłaszane przez portal dla naszego zapytania. Portal liczy okrąg lub całe gminy, a zostają tylko oferty z prostokąta (kwadrat w okręgu to ok. 64 % jego pola), więc 100 % nie jest celem; dużo niższy udział oznacza, że pełne pobranie jeszcze nie przeszło."
        }
      >
        {KIND_LABEL_PLURAL[kind].toLowerCase()}: {ours}
        {reported !== null && ` / portal ${reported}${pct !== null ? ` (${pct}%)` : ""}`}
      </span>
    );
  }).filter(Boolean);
  if (!parts.length) return null;
  return <p className="mt-1 flex flex-wrap gap-x-3 text-xs">{parts}</p>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export function ScrapePage() {
  const loop = useScrapeLoop();
  const status = useScrapeStatus(loop.running ? 3000 : 20_000);
  const runs = useRuns(20);
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: api.cancelScrape,
    onSuccess: () => {
      loop.stop();
      void qc.invalidateQueries({ queryKey: queryKeys.status });
      void qc.invalidateQueries({ queryKey: queryKeys.runs });
    },
  });
  const [probes, setProbes] = useState<Partial<Record<Source, SourceProbe>>>({});
  const probe = useMutation({
    mutationFn: (source: Source) => api.probeSource(source),
    onSuccess: (res) => setProbes((p) => ({ ...p, [res.source]: res })),
  });
  const reset = useMutation({
    mutationFn: (source: Source) => api.resetSource(source),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.status }),
  });
  const s = status.data;
  const run = s?.currentRun;
  const busy = loop.running || (s?.queue.queued ?? 0) + (s?.queue.running ?? 0) > 0;

  // Re-matching of all listings runs in short batches so it also works within Netlify's function time limit.
  const [dedup, setDedup] = useState<{ running: boolean; processed: number; moved: number; done: boolean; error: string | null }>({ running: false, processed: 0, moved: 0, done: false, error: null });
  const dedupStop = useRef(false);
  const recomputeDuplicates = async () => {
    if (dedup.running) {
      dedupStop.current = true;
      return;
    }
    dedupStop.current = false;
    setDedup({ running: true, processed: 0, moved: 0, done: false, error: null });
    let afterId = 0;
    let processed = 0;
    let moved = 0;
    try {
      for (;;) {
        const r = await api.dedupReassign(afterId);
        processed += r.processed;
        moved += r.moved;
        setDedup({ running: true, processed, moved, done: false, error: null });
        if (r.nextAfterId === null || dedupStop.current) break;
        afterId = r.nextAfterId;
      }
      setDedup({ running: false, processed, moved, done: !dedupStop.current, error: null });
      void qc.invalidateQueries({ queryKey: ["properties"] });
      void qc.invalidateQueries({ queryKey: queryKeys.status });
    } catch (err) {
      setDedup({ running: false, processed, moved, done: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 overflow-y-auto p-4" style={{ maxHeight: "100%" }}>
      <Card
        title="Pobieranie ofert"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void loop.start("incremental")} loading={loop.running} disabled={loop.running}>
              <RefreshCw className="h-4 w-4" /> {MODE_LABEL.incremental}
            </Button>
            <Button onClick={() => void loop.start("backfill")} disabled={loop.running} title="Przechodzi wszystkie strony wyników (długie; najlepiej lokalnie: pnpm worker --mode backfill)">
              <Download className="h-4 w-4" /> {MODE_LABEL.backfill}
            </Button>
            <Button onClick={() => void loop.start("sweep")} disabled={loop.running} title="Odwiedza wszystkie strony i oznacza wygasłe ogłoszenia">
              <Search className="h-4 w-4" /> {MODE_LABEL.sweep}
            </Button>
            {busy && (
              <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>
                <Ban className="h-4 w-4" /> Anuluj
              </Button>
            )}
            <Button
              onClick={() => void recomputeDuplicates()}
              disabled={loop.running}
              title="Ponownie dopasowuje wszystkie ogłoszenia do nieruchomości według aktualnych reguł (po dodaniu portali lub zmianie reguł)"
            >
              <GitMerge className="h-4 w-4" /> {dedup.running ? "Zatrzymaj scalanie" : "Przelicz duplikaty"}
            </Button>
          </div>
        }
      >
        {(dedup.running || dedup.done || dedup.error) && (
          <p className={dedup.error ? "mb-3 text-sm text-rose-700" : "mb-3 text-sm text-slate-700"}>
            {dedup.error
              ? `Przeliczanie przerwane: ${dedup.error}`
              : `${dedup.running ? "Przeliczam duplikaty…" : "Przeliczono duplikaty."} Sprawdzono ${dedup.processed} ogłoszeń, ${dedup.moved} zmieniło nieruchomość.`}
          </p>
        )}
        <p className="mb-3 text-sm text-slate-600">
          „{MODE_LABEL.incremental}” przegląda najnowsze strony każdego portalu, aż trafi na znane ogłoszenia. Praca dzieje się w krótkich
          porcjach, więc możesz zostawić tę kartę otwartą albo zamknąć — niedokończone zadania dokończy harmonogram lub kolejne kliknięcie.
        </p>
        <ErrorText error={loop.error ?? status.error} />
        {s && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Nieruchomości" value={s.counts.activeProperties} />
            <Stat label="Ogłoszenia aktywne" value={s.counts.activeListings} />
            <Stat label="Ukryte" value={s.counts.hidden} />
            <Stat label="W kolejce" value={s.queue.queued + s.queue.running} />
            <Stat label="Błędy zadań" value={s.queue.failed} />
          </div>
        )}
        {run && (
          <div className="mt-3 rounded-md border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Przebieg #{run.id}</span>
              <Badge className="bg-slate-100 text-slate-700">{MODE_LABEL[run.mode]}</Badge>
              <Badge className="bg-sky-100 text-sky-700">{RUN_STATUS_LABEL[run.status]}</Badge>
              <span className="text-xs text-slate-500">od {formatDateTime(run.startedAt)}</span>
            </div>
            <p className="mt-1 text-slate-700">
              żądania {run.stats.requests ?? 0} · strony {run.stats.pages ?? 0} · nowe ogłoszenia {run.stats.newListings ?? 0} · zaktualizowane{" "}
              {run.stats.updatedListings ?? 0} · nowe nieruchomości {run.stats.newProperties ?? 0} · uzupełnione współrzędne {run.stats.enriched ?? 0} · wygasłe{" "}
              {run.stats.deactivated ?? 0}
            </p>
            {run.stats.errors && run.stats.errors.length > 0 && (
              <details className="mt-1 text-xs text-rose-700">
                <summary>Błędy ({run.stats.errors.length})</summary>
                <ul className="list-disc pl-4">
                  {run.stats.errors.slice(-10).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </details>
            )}
            {s && s.jobs.length > 0 && (
              <table className="mt-2 w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1">Zadanie</th>
                    <th>Źródło</th>
                    <th>Rodzaj</th>
                    <th>Status</th>
                    <th>Strona</th>
                    <th>Uwagi</th>
                  </tr>
                </thead>
                <tbody>
                  {s.jobs.map((j) => (
                    <tr key={j.id} className="border-t border-slate-100">
                      <td className="py-1">{j.type}</td>
                      <td>{SOURCE_LABEL[j.source as Source] ?? j.source}</td>
                      <td>{j.kind ? KIND_LABEL_PLURAL[j.kind] : "—"}</td>
                      <td>{JOB_STATUS_LABEL[j.status]}</td>
                      <td>{typeof j.cursor?.page === "number" ? j.cursor.page : "—"}</td>
                      <td className="max-w-xs truncate text-slate-500" title={j.lastError ?? ""}>
                        {j.status === "queued" && Date.parse(j.notBefore) > Date.now() ? `od ${formatDateTime(j.notBefore)} ` : ""}
                        {j.lastError ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {loop.log.length > 0 && (
          <pre className="mt-3 max-h-48 overflow-y-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{loop.log.join("\n")}</pre>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Źródła">
          <p className="mb-2 text-xs text-slate-500">
            „w bazie / portal” porównuje nasze aktywne ogłoszenia z liczbą wyników zgłaszaną przez portal dla naszego zapytania. Portal liczy okrąg
            albo całe gminy, a zostają tylko oferty z prostokąta, więc ok. 60–70 % to komplet; wyraźnie mniej = brakuje pełnego pobrania.
          </p>
          {s?.sources.length ? (
            <ul className="space-y-2 text-sm">
              {s.sources.map((src) => (
                <li key={src.source} className="rounded-md border border-slate-200 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{SOURCE_LABEL[src.source as Source] ?? src.source}</span>
                    {src.blockedUntil ? (
                      <Badge className="bg-rose-100 text-rose-700">zablokowane do {formatDateTime(src.blockedUntil)}</Badge>
                    ) : (
                      <Badge className="bg-emerald-100 text-emerald-700">ok</Badge>
                    )}
                    <span className="ml-auto text-xs text-slate-500">{src.requestsLast10Min} żądań / 10 min</span>
                  </div>
                  <Coverage have={s.counts.bySource[src.source]} totals={src.meta.totals as SourceTotals | undefined} />
                  <p className="text-xs text-slate-500">
                    ostatnie żądanie {formatRelative(src.lastRequestAt)} · ostatni sukces {formatRelative(src.lastSuccessAt)}
                    {src.lastError && ` · ${src.lastError}`}
                    {src.consecutiveBlocks > 0 && ` · blokad z rzędu: ${src.consecutiveBlocks}`}
                    {typeof src.meta.buildId === "string" && ` · buildId ${src.meta.buildId}`}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => probe.mutate(src.source as Source)} loading={probe.isPending && probe.variables === src.source} title="Wysyła jedno zapytanie testowe (poza limitem)">
                      <Stethoscope className="h-3.5 w-3.5" /> Sprawdź połączenie
                    </Button>
                    {src.blockedUntil && (
                      <Button size="sm" onClick={() => reset.mutate(src.source as Source)} loading={reset.isPending && reset.variables === src.source} title="Czyści blokadę po stronie aplikacji; portal może nadal odrzucać">
                        <Unlock className="h-3.5 w-3.5" /> Zresetuj blokadę
                      </Button>
                    )}
                    {probes[src.source as Source] && (
                      <span className={probes[src.source as Source]!.ok ? "text-xs text-emerald-700" : "text-xs text-rose-700"}>
                        {probes[src.source as Source]!.ok
                          ? `odpowiada (HTTP 200, ${probes[src.source as Source]!.ms} ms)`
                          : `nie odpowiada: ${probes[src.source as Source]!.error ?? `HTTP ${probes[src.source as Source]!.status}${probes[src.source as Source]!.server ? ` (${probes[src.source as Source]!.server})` : ""}`}`}
                        {probes[src.source as Source]!.viaProxy && " · przez proxy"}
                      </span>
                    )}
                  </div>
                  {src.source === "olx" && src.blockedUntil && (
                    <p className="mt-1 text-xs text-amber-700">
                      OLX blokuje adres IP po serii żądań i taka blokada po stronie portalu może trwać wiele godzin. Najpierw „Sprawdź połączenie”; jeśli odpowiada, zresetuj blokadę. Jeśli nie — zmień adres IP (np. proxy w <code>OLX_PROXY_URL</code>) albo poczekaj.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Jeszcze nic nie pobrano.</p>
          )}
        </Card>
        <Card title="Historia przebiegów">
          <ErrorText error={runs.error} />
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1">#</th>
                <th>Tryb</th>
                <th>Start</th>
                <th>Status</th>
                <th>Nowe</th>
              </tr>
            </thead>
            <tbody>
              {(runs.data?.runs ?? []).map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-1">{r.id}</td>
                  <td>
                    {MODE_LABEL[r.mode]} <span className="text-slate-400">({TRIGGER_LABEL[r.trigger]})</span>
                  </td>
                  <td>{formatDateTime(r.startedAt)}</td>
                  <td>{RUN_STATUS_LABEL[r.status]}</td>
                  <td title={`ogłoszenia ${r.stats.newListings ?? 0}, nieruchomości ${r.stats.newProperties ?? 0}`}>
                    {r.stats.newProperties ?? 0} / {r.stats.newListings ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
