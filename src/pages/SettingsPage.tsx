import { useMutation } from "@tanstack/react-query";
import { Save, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { areaCenter, areaCoveringRadiusKm, areaSizeKm, deriveSettingsFromArea, gminasInArea, type Area } from "@shared/area";
import { KINDS, SOURCES } from "@shared/constants";
import { SettingsSchema, type Settings } from "@shared/schemas";
import { api } from "@/api/client";
import { useAreaOutside, useAreaPrune, useSaveSettings, useSettings } from "@/api/hooks";
import { AreaPicker } from "@/components/settings/AreaPicker";
import { useGminy } from "@/hooks/useGminy";
import { Button, Card, ErrorText, Field, Input, Spinner, Switch } from "@/components/ui";
import { KIND_LABEL_PLURAL, PORTAL_NOTES, SOURCE_LABEL } from "@/i18n/pl";

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
  useEffect(() => {
    if (query.data && !form) setForm(structuredClone(query.data));
  }, [query.data, form]);

  const gminy = useGminy();
  const outside = useAreaOutside();
  const prune = useAreaPrune();
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
  const inArea = gminy.data ? gminasInArea(gminy.data.gminy, f.area) : [];
  const chosen = inArea.filter((g) => !f.excludedGminy.includes(g.terc));
  const size = areaSizeKm(f.area);
  /** Preview of what the server will derive for each portal when the form is saved. */
  const derived = gminy.data ? deriveSettingsFromArea(f, gminy.data.gminy) : null;
  const setArea = (area: Area) => set((s) => {
    s.area = area;
    s.center = areaCenter(area);
    s.radiusKm = Math.min(100, areaCoveringRadiusKm(area));
  });
  const setBound = (key: keyof Area, value: number) => {
    if (!Number.isFinite(value)) return;
    setArea({ ...f.area, [key]: value });
  };

  const onSave = () => {
    const parsed = SettingsSchema.safeParse(form);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      return;
    }
    setIssues([]);
    // The server derives the portal queries from the rectangle; the form takes those over so it is clean after saving.
    save.mutate(parsed.data, { onSuccess: (saved) => setForm(structuredClone(saved)) });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 overflow-y-auto p-4" style={{ maxHeight: "100%" }}>
      <Card title="Obszar poszukiwań">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Prostokąt na mapie wyznacza, co trafia do bazy: portale z promieniem dostają okrąg obejmujący prostokąt, portale bez promienia
              (Gratka, Morizon, Adresowo) listę gmin, które prostokąt obejmuje, a ogłoszenia ze współrzędnymi spoza prostokąta są odrzucane.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Południe (szer.)"><Input value={f.area.south} onChange={(e) => setBound("south", Number(e.target.value))} inputMode="decimal" /></Field>
              <Field label="Północ (szer.)"><Input value={f.area.north} onChange={(e) => setBound("north", Number(e.target.value))} inputMode="decimal" /></Field>
              <Field label="Zachód (dł.)"><Input value={f.area.west} onChange={(e) => setBound("west", Number(e.target.value))} inputMode="decimal" /></Field>
              <Field label="Wschód (dł.)"><Input value={f.area.east} onChange={(e) => setBound("east", Number(e.target.value))} inputMode="decimal" /></Field>
            </div>
            <p className="text-xs text-slate-500">
              {size.widthKm.toFixed(1)} × {size.heightKm.toFixed(1)} km, środek {f.center.lat.toFixed(4)}, {f.center.lon.toFixed(4)}; okrąg obejmujący: {f.radiusKm} km
              (tyle dostają OLX, Otodom, Nieruchomosci-online i Domiporta).
            </p>
            <div className="flex gap-4 text-sm">
              {KINDS.map((k) => (
                <label key={k} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={f.kinds.includes(k)} onChange={() => set((s) => (s.kinds = toggle(s.kinds, k)))} />
                  {KIND_LABEL_PLURAL[k]}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {outside.data && outside.data.count > 0 && (
                <Button size="sm" variant="danger" onClick={() => prune.mutate()} loading={prune.isPending} title="Usuwa z bazy ogłoszenia, których współrzędne leżą poza zapisanym prostokątem">
                  Usuń {outside.data.count} ogłoszeń spoza obszaru
                </Button>
              )}
              {prune.data && <span className="text-xs text-emerald-700">Usunięto {prune.data.deleted}.</span>}
            </div>
          </div>
          <AreaPicker area={f.area} onChange={setArea} />
        </div>
        <div className="mt-4">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Gminy w obszarze {gminy.isLoading ? "(wczytywanie…)" : `(${chosen.length} z ${inArea.length})`}
          </h4>
          <ErrorText error={gminy.error} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {inArea.map((g) => (
              <label key={g.terc} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-slate-900"
                  checked={!f.excludedGminy.includes(g.terc)}
                  onChange={() => set((s) => (s.excludedGminy = toggle(s.excludedGminy, g.terc)))}
                />
                {g.name}
                <span className="text-xs text-slate-400">{g.type === 1 ? "miasto" : `pow. ${g.powiat}`}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Odznaczone gminy nie są przeszukiwane na Gratce, Morizonie i Adresowo. Granice gmin: © OpenStreetMap.
          </p>
        </div>
      </Card>

      <Card title="Portale">
        <p className="mb-3 text-sm text-slate-600">
          Ustawienia wyszukiwania każdego portalu wynikają z prostokąta i są przeliczane przy zapisie: portale z promieniem dostają okrąg
          obejmujący prostokąt wokół gminy w jego środku, pozostałe listę zaznaczonych gmin. Tu tylko włączasz lub wyłączasz portale.
        </p>
        <ul className="divide-y divide-slate-200">
          {SOURCES.map((source) => {
            const cfg = f[source];
            const d = derived?.[source];
            const summary =
              source === "olx"
                ? `${f.olx.cityName || "miasto w środku obszaru"}${f.olx.cityId ? ` (id ${f.olx.cityId})` : ""}, ${d ? (d as { distanceKm: number }).distanceKm : f.olx.distanceKm} km`
                : source === "otodom"
                  ? `${d ? (d as { locationPath: string }).locationPath : f.otodom.locationPath}, ${d ? (d as { radiusKm: number }).radiusKm : f.otodom.radiusKm} km`
                  : (() => {
                      const pc = (d ?? cfg) as { location: string; radiusKm: number };
                      const parts = pc.location.split(",").map((x) => x.trim()).filter(Boolean);
                      return pc.radiusKm > 0 ? `${parts[0]}, ${pc.radiusKm} km` : parts.length > 3 ? `${parts.length} gmin (${parts.slice(0, 3).join(", ")}…)` : parts.join(", ");
                    })();
            return (
              <li key={source} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{SOURCE_LABEL[source]}</span>
                    <span className="truncate text-sm text-slate-600" title={source === "olx" ? undefined : ((d ?? cfg) as { location?: string; locationPath?: string }).location ?? ((d ?? cfg) as { locationPath?: string }).locationPath}>
                      {summary}
                    </span>
                  </div>
                  {PORTAL_NOTES[source] && <p className="text-xs text-slate-500">{PORTAL_NOTES[source]}</p>}
                </div>
                {source === "otodom" && (
                  <Button
                    size="sm"
                    onClick={() => {
                      const oto = derived?.otodom ?? f.otodom;
                      otodomCheck.mutate(`https://www.otodom.pl/pl/wyniki/sprzedaz/dzialka/${oto.locationPath}?distanceRadius=${oto.radiusKm}`);
                    }}
                    loading={otodomCheck.isPending}
                    title="Porównuje liczbę ofert z promieniem i bez niego"
                  >
                    Sprawdź promień
                  </Button>
                )}
                <Switch checked={cfg.enabled} onChange={(v) => set((s) => (s[source].enabled = v))} label="włączone" />
              </li>
            );
          })}
        </ul>
        <ErrorText error={otodomCheck.error} />
        {otodomCheck.data && (
          <div className="mt-2 space-y-1 rounded-md bg-slate-50 p-3 text-sm">
            <p>
              Ścieżka <code>{otodomCheck.data.locationPath}</code>, promień {otodomCheck.data.radiusKm} km → {otodomCheck.data.totalWithRadius ?? "?"} ofert
              {otodomCheck.data.totalWithoutRadius !== null && ` (bez promienia: ${otodomCheck.data.totalWithoutRadius})`}.
            </p>
            {otodomCheck.data.radiusIgnored ? (
              <p className="text-amber-700">Otodom zignorował ten promień — sprawdź ponownie za chwilę albo lekko zmień prostokąt, by zmienić promień.</p>
            ) : (
              otodomCheck.data.radiusKm > 0 && <p className="text-emerald-700">Otodom respektuje ten promień.</p>
            )}
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
