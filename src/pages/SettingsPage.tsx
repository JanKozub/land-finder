import { useMutation } from "@tanstack/react-query";
import { Save, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { KINDS, OLX_DISTANCES, OTODOM_RADII } from "@shared/constants";
import { SettingsSchema, type Settings } from "@shared/schemas";
import { api } from "@/api/client";
import { useSaveSettings, useSettings } from "@/api/hooks";
import { CenterPicker } from "@/components/settings/CenterPicker";
import { Button, Card, ErrorText, Field, Input, Spinner, Switch } from "@/components/ui";
import { KIND_LABEL_PLURAL } from "@/i18n/pl";

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function numOrNull(v: string): number | null {
  const n = Number(v.replace(",", "."));
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}

export function SettingsPage() {
  const query = useSettings();
  const save = useSaveSettings();
  const [form, setForm] = useState<Settings | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [town, setTown] = useState("");
  const [otodomUrl, setOtodomUrl] = useState("");
  useEffect(() => {
    if (query.data && !form) setForm(structuredClone(query.data));
  }, [query.data, form]);

  const olxLookup = useMutation({ mutationFn: (q: string) => api.olxCities(q) });
  const otodomCheck = useMutation({ mutationFn: (url: string) => api.validateOtodom(url) });
  const notifyTest = useMutation({ mutationFn: api.notifyTest });

  if (!form) return <div className="p-6"><Spinner /><ErrorText error={query.error} /></div>;
  const f = form;
  const set = (patch: (s: Settings) => void) =>
    setForm((prev) => {
      const next = structuredClone(prev!);
      patch(next);
      return next;
    });
  const dirty = JSON.stringify(form) !== JSON.stringify(query.data);

  const onSave = () => {
    const parsed = SettingsSchema.safeParse(form);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      return;
    }
    setIssues([]);
    save.mutate(parsed.data);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 overflow-y-auto p-4" style={{ maxHeight: "100%" }}>
      <Card title="Obszar poszukiwań" >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Kliknij na mapie, aby ustawić centrum. Promień służy do filtrów i okręgu na mapie; portale mają własne ustawienia poniżej.</p>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Szerokość"><Input value={f.center.lat} onChange={(e) => set((s) => (s.center.lat = Number(e.target.value)))} /></Field>
              <Field label="Długość"><Input value={f.center.lon} onChange={(e) => set((s) => (s.center.lon = Number(e.target.value)))} /></Field>
              <Field label="Promień (km)"><Input type="number" min={1} max={100} value={f.radiusKm} onChange={(e) => set((s) => (s.radiusKm = Number(e.target.value)))} /></Field>
            </div>
            <div className="flex gap-4 text-sm">
              {KINDS.map((k) => (
                <label key={k} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={f.kinds.includes(k)} onChange={() => set((s) => (s.kinds = toggle(s.kinds, k)))} />
                  {KIND_LABEL_PLURAL[k]}
                </label>
              ))}
            </div>
          </div>
          <CenterPicker center={f.center} radiusKm={f.radiusKm} onPick={(lat, lon) => set((s) => (s.center = { lat, lon }))} />
        </div>
      </Card>

      <Card title="OLX" actions={<Switch checked={f.olx.enabled} onChange={(v) => set((s) => (s.olx.enabled = v))} label="włączone" />}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="ID miasta (city_id)" hint="Wieliczka = 128097, Kraków = 8959, Niepołomice = 121091, Skawina = 94873">
            <Input type="number" value={f.olx.cityId} onChange={(e) => set((s) => (s.olx.cityId = Number(e.target.value)))} />
          </Field>
          <Field label="Odległość (km)" hint="Dowolna liczba całkowita 0–100 (OLX przyjmuje każdą); 0 = tylko miasto.">
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              list="olx-distances"
              value={f.olx.distanceKm}
              onChange={(e) => set((s) => (s.olx.distanceKm = Number(e.target.value)))}
            />
            <datalist id="olx-distances">
              {OLX_DISTANCES.map((d) => (
                <option key={d} value={d} label={d === 0 ? "tylko miasto" : `${d} km`} />
              ))}
            </datalist>
          </Field>
          <Field label="Znajdź ID po nazwie" hint="Szuka w ogłoszeniach OLX; nie zawsze się uda — wtedy wpisz ID ręcznie.">
            <div className="flex gap-2">
              <Input value={town} onChange={(e) => setTown(e.target.value)} placeholder="np. Niepołomice" />
              <Button onClick={() => olxLookup.mutate(town)} loading={olxLookup.isPending} disabled={town.trim().length < 2}>Znajdź</Button>
            </div>
          </Field>
        </div>
        <ErrorText error={olxLookup.error} />
        {olxLookup.data && (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {olxLookup.data.candidates.length === 0 && <li className="text-slate-500">Nie znaleziono — wpisz ID ręcznie.</li>}
            {olxLookup.data.candidates.map((c) => (
              <li key={c.id}>
                <Button size="sm" onClick={() => set((s) => (s.olx.cityId = c.id))}>
                  {c.name} {c.region ? `(${c.region})` : ""} → {c.id}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Otodom" actions={<Switch checked={f.otodom.enabled} onChange={(v) => set((s) => (s.otodom.enabled = v))} label="włączone" />}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Ścieżka lokalizacji" hint="Z adresu wyszukiwania, np. malopolskie/wielicki/wieliczka (poziom gminy działa poprawnie z promieniem).">
            <Input value={f.otodom.locationPath} onChange={(e) => set((s) => (s.otodom.locationPath = e.target.value.trim()))} />
          </Field>
          <Field label="Promień (km)" hint="Dowolna liczba całkowita 0–100; 0 = bez promienia. Otodom bywa kapryśny i czasem zwraca wynik jak bez promienia — sprawdź przyciskiem.">
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                list="otodom-radii"
                value={f.otodom.radiusKm}
                onChange={(e) => set((s) => (s.otodom.radiusKm = Number(e.target.value)))}
              />
              <datalist id="otodom-radii">
                {OTODOM_RADII.map((r) => (
                  <option key={r} value={r} label={r === 0 ? "bez promienia" : `${r} km`} />
                ))}
              </datalist>
              <Button
                onClick={() => otodomCheck.mutate(`https://www.otodom.pl/pl/wyniki/sprzedaz/dzialka/${f.otodom.locationPath}?distanceRadius=${f.otodom.radiusKm}`)}
                loading={otodomCheck.isPending}
                disabled={!f.otodom.locationPath || f.otodom.radiusKm <= 0}
                title="Porównuje liczbę ofert z promieniem i bez niego"
              >
                Sprawdź promień
              </Button>
            </div>
          </Field>
        </div>
        <Field label="Sprawdź adres wyszukiwania Otodom" hint="Wklej URL z otodom.pl po ustawieniu miejscowości i promienia; sprawdzimy, czy portal respektuje promień." className="mt-3">
          <div className="flex gap-2">
            <Input value={otodomUrl} onChange={(e) => setOtodomUrl(e.target.value)} placeholder="https://www.otodom.pl/pl/wyniki/sprzedaz/dzialka/..." />
            <Button onClick={() => otodomCheck.mutate(otodomUrl)} loading={otodomCheck.isPending} disabled={!otodomUrl.startsWith("http")}>Sprawdź</Button>
          </div>
        </Field>
        <ErrorText error={otodomCheck.error} />
        {otodomCheck.data && (
          <div className="mt-2 space-y-1 rounded-md bg-slate-50 p-3 text-sm">
            <p>
              Ścieżka <code>{otodomCheck.data.locationPath}</code>, promień {otodomCheck.data.radiusKm} km → {otodomCheck.data.totalWithRadius ?? "?"} ofert
              {otodomCheck.data.totalWithoutRadius !== null && ` (bez promienia: ${otodomCheck.data.totalWithoutRadius})`}.
            </p>
            {otodomCheck.data.radiusIgnored ? (
              <p className="text-amber-700">
                Otodom zignorował promień {otodomCheck.data.radiusKm} km dla tej ścieżki — wynik jest taki sam jak bez promienia. Sprawdź ponownie za chwilę
                albo spróbuj sąsiedniej wartości (np. 18, 20 lub 22).{" "}
                {otodomCheck.data.suggestedPath && `Proponowana ścieżka gminy: ${otodomCheck.data.suggestedPath} (${otodomCheck.data.suggestedTotal ?? "?"} ofert).`}
              </p>
            ) : (
              otodomCheck.data.radiusKm > 0 && <p className="text-emerald-700">Otodom respektuje ten promień.</p>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => set((s) => { s.otodom.locationPath = otodomCheck.data!.locationPath; s.otodom.radiusKm = otodomCheck.data!.radiusKm; })}>Użyj tej ścieżki</Button>
              {otodomCheck.data.suggestedPath && (
                <Button size="sm" variant="primary" onClick={() => set((s) => { s.otodom.locationPath = otodomCheck.data!.suggestedPath!; s.otodom.radiusKm = otodomCheck.data!.radiusKm; })}>Użyj ścieżki gminy</Button>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card title="Automatyczne pobieranie" actions={<Switch checked={f.autoScrape.enabled} onChange={(v) => set((s) => (s.autoScrape.enabled = v))} label="włączone" />}>
        <p className="mb-3 text-sm text-slate-600">Funkcja cykliczna Netlify budzi się co 30 minut; tutaj decydujesz, jak często faktycznie pobierać i w jakich godzinach (czas polski).</p>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Co ile minut"><Input type="number" min={15} max={1440} step={15} value={f.autoScrape.intervalMin} onChange={(e) => set((s) => (s.autoScrape.intervalMin = Number(e.target.value)))} /></Field>
          <Field label="Od godziny"><Input type="number" min={0} max={23} value={f.autoScrape.activeHours.from} onChange={(e) => set((s) => (s.autoScrape.activeHours.from = Number(e.target.value)))} /></Field>
          <Field label="Do godziny"><Input type="number" min={1} max={24} value={f.autoScrape.activeHours.to} onChange={(e) => set((s) => (s.autoScrape.activeHours.to = Number(e.target.value)))} /></Field>
          <Field label="Wygasłe co (dni)" hint="Pełny przegląd portali oznaczający usunięte ogłoszenia."><Input type="number" min={1} max={30} value={f.autoScrape.sweepEveryDays} onChange={(e) => set((s) => (s.autoScrape.sweepEveryDays = Number(e.target.value)))} /></Field>
        </div>
      </Card>

      <Card
        title="Powiadomienia (Telegram)"
        actions={
          <div className="flex items-center gap-3">
            <Switch checked={f.alert.enabled} onChange={(v) => set((s) => (s.alert.enabled = v))} label="włączone" />
            <Button size="sm" onClick={() => notifyTest.mutate()} loading={notifyTest.isPending}><Send className="h-3.5 w-3.5" /> Wyślij test</Button>
          </div>
        }
      >
        <ErrorText error={notifyTest.error} />
        {notifyTest.data && <p className="mb-2 text-sm text-emerald-700">Wysłano: {notifyTest.data.sent.join(", ")}</p>}
        <p className="mb-3 text-sm text-slate-600">Token bota i chat ID ustawiasz w zmiennych środowiskowych (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID). Poniżej kryteria, które muszą spełnić nowe oferty.</p>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Rodzaje">
            <div className="flex gap-3 pt-2 text-sm">
              {KINDS.map((k) => (
                <label key={k} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={f.alert.kinds.includes(k)} onChange={() => set((s) => (s.alert.kinds = toggle(s.alert.kinds, k)))} />
                  {KIND_LABEL_PLURAL[k]}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Cena max (zł)"><Input value={f.alert.maxPrice ?? ""} onChange={(e) => set((s) => (s.alert.maxPrice = numOrNull(e.target.value)))} placeholder="bez limitu" /></Field>
          <Field label="Powierzchnia min (m²)"><Input value={f.alert.minArea ?? ""} onChange={(e) => set((s) => (s.alert.minArea = numOrNull(e.target.value)))} placeholder="bez limitu" /></Field>
          <Field label="Max zł/m²"><Input value={f.alert.maxPricePerM2 ?? ""} onChange={(e) => set((s) => (s.alert.maxPricePerM2 = numOrNull(e.target.value)))} placeholder="bez limitu" /></Field>
        </div>
        <div className="mt-3"><Switch checked={f.alert.privateOnly} onChange={(v) => set((s) => (s.alert.privateOnly = v))} label="Tylko oferty prywatne" /></div>
      </Card>

      {issues.length > 0 && (
        <ul className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      <ErrorText error={save.error} />
      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/95 py-3">
        {save.isSuccess && !dirty && <span className="text-sm text-emerald-700">Zapisano.</span>}
        <Button variant="primary" onClick={onSave} loading={save.isPending} disabled={!dirty}>
          <Save className="h-4 w-4" /> Zapisz ustawienia
        </Button>
      </div>
    </div>
  );
}
