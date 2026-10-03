import { Ban, Download, RefreshCw, Search } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Source } from "@shared/constants";
import { api } from "@/api/client";
import { queryKeys, useRuns, useScrapeStatus } from "@/api/hooks";
import { Badge, Button, Card, ErrorText } from "@/components/ui";
import { useScrapeLoop } from "@/hooks/useScrapeLoop";
import { JOB_STATUS_LABEL, KIND_LABEL_PLURAL, MODE_LABEL, RUN_STATUS_LABEL, SOURCE_LABEL, TRIGGER_LABEL } from "@/i18n/pl";
import { formatDateTime, formatRelative } from "@/lib/format";

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
  const s = status.data;
  const run = s?.currentRun;
  const busy = loop.running || (s?.queue.queued ?? 0) + (s?.queue.running ?? 0) > 0;

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
          </div>
        }
      >
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
                  <p className="text-xs text-slate-500">
                    ostatnie żądanie {formatRelative(src.lastRequestAt)} · ostatni sukces {formatRelative(src.lastSuccessAt)}
                    {src.lastError && ` · ${src.lastError}`}
                    {typeof src.meta.buildId === "string" && ` · buildId ${src.meta.buildId}`}
                  </p>
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
