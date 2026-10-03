import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { ScrapeMode, ScrapeStatusDto } from "@shared/schemas";
import { api, ApiClientError } from "@/api/client";
import { queryKeys } from "@/api/hooks";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Drives a manual scrape: starts a run, then calls the worker slice endpoint until the queue is empty.
 * Each slice is short (function time limit), so the loop lives in the browser.
 */
export function useScrapeLoop() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const push = (line: string) => setLog((l) => [...l.slice(-60), `${new Date().toLocaleTimeString("pl-PL")} ${line}`]);

  const start = useCallback(
    async (mode: ScrapeMode) => {
      if (running) return;
      cancelled.current = false;
      setError(null);
      setRunning(true);
      try {
        try {
          const started = await api.startScrape(mode);
          push(`Start przebiegu #${started.run.id} (${mode}), zadań: ${started.jobs}`);
        } catch (err) {
          if (err instanceof ApiClientError && err.status === 409) push("Inny przebieg jest w toku — kontynuuję jego kolejkę.");
          else throw err;
        }
        let idle = 0;
        for (;;) {
          if (cancelled.current) break;
          const { summary, status } = await api.workerSlice();
          qc.setQueryData<ScrapeStatusDto>(queryKeys.status, status);
          if (summary.skipped === "locked") {
            push("Inny worker trzyma blokadę, czekam…");
            await sleep(4000);
            continue;
          }
          const s = status.currentRun?.stats;
          push(
            `Porcja: ${summary.processed} zad., nowe ogł. ${s?.newListings ?? 0}, nowe nieruch. ${s?.newProperties ?? 0}, enrich ${s?.enriched ?? 0}; kolejka ${status.queue.queued}`,
          );
          if (status.queue.queued === 0 && status.queue.running === 0) break;
          if (summary.processed === 0) {
            idle += 1;
            const nextTimes = status.jobs.filter((j) => j.status === "queued").map((j) => Date.parse(j.notBefore));
            const wait = nextTimes.length ? Math.min(30_000, Math.max(1500, Math.min(...nextTimes) - Date.now())) : 2000;
            const blocked = status.sources.filter((src) => src.blockedUntil);
            if (blocked.length) push(`Źródło zablokowane: ${blocked.map((b) => `${b.source} do ${new Date(b.blockedUntil!).toLocaleTimeString("pl-PL")}`).join(", ")}`);
            if (idle > 40) {
              push("Kolejka czeka na odblokowanie źródła — resztę dokończy harmonogram lub kolejne kliknięcie.");
              break;
            }
            await sleep(wait);
          } else idle = 0;
          void qc.invalidateQueries({ queryKey: ["properties"] });
        }
        push(cancelled.current ? "Przerwano (zadania zostają w kolejce)." : "Gotowe.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        push(`Błąd: ${message}`);
      } finally {
        setRunning(false);
        void qc.invalidateQueries({ queryKey: ["properties"] });
        void qc.invalidateQueries({ queryKey: queryKeys.status });
        void qc.invalidateQueries({ queryKey: queryKeys.runs });
      }
    },
    [qc, running],
  );

  const stop = useCallback(() => {
    cancelled.current = true;
  }, []);

  return { running, log, error, start, stop };
}
