import { TZDate } from "@date-fns/tz";
import { SOURCE_LABELS, type Source } from "../../shared/constants";
import { haversineKm } from "../../shared/geo";
import type { PropertyRow } from "../db/schema";

const plNumber = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });
/** pl-PL grouping uses non-breaking spaces; plain spaces read better in chat clients. */
const plFormat = { format: (n: number) => plNumber.format(n).replace(/[\u00a0\u202f]/g, " ") };

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatPln(n: number): string {
  return `${plFormat.format(n)} zł`;
}

export function formatArea(m2: number, kind: PropertyRow["kind"]): string {
  const base = `${plFormat.format(m2)} m²`;
  if (kind === "plot" && m2 >= 100) return `${base} (${(m2 / 100).toFixed(1).replace(".", ",")} a)`;
  return base;
}

export function formatDateWarsaw(d: Date): string {
  const z = new TZDate(d, "Europe/Warsaw");
  const dd = String(z.getDate()).padStart(2, "0");
  const mm = String(z.getMonth() + 1).padStart(2, "0");
  const hh = String(z.getHours()).padStart(2, "0");
  const mi = String(z.getMinutes()).padStart(2, "0");
  return `${dd}.${mm} ${hh}:${mi}`;
}

export interface DigestOptions {
  appBaseUrl: string;
  center: { lat: number; lon: number };
  total: number;
  chunkIndex: number;
  chunkCount: number;
}

export function formatPropertyLine(p: PropertyRow, opts: Pick<DigestOptions, "appBaseUrl" | "center">): string {
  const icon = p.kind === "plot" ? "🟦" : "🏠";
  const kindLabel = p.kind === "plot" ? "Działka" : "Dom";
  const head = [kindLabel, p.areaM2 !== null ? formatArea(p.areaM2, p.kind) : null].filter(Boolean).join(" · ");
  const extras: string[] = [];
  if (p.kind === "house" && p.plotAreaM2 !== null) extras.push(`działka ${formatArea(p.plotAreaM2, "plot")}`);
  const priceParts = [
    p.price !== null ? formatPln(p.price) : "cena do uzgodnienia",
    p.pricePerM2 !== null ? `${plFormat.format(p.pricePerM2)} zł/m²` : null,
  ].filter(Boolean);
  const where = [p.city, p.district].filter(Boolean).join(", ");
  const dist =
    p.lat !== null && p.lon !== null ? `${haversineKm(opts.center.lat, opts.center.lon, p.lat, p.lon).toFixed(1).replace(".", ",")} km` : null;
  const approx = p.locationPrecision === "approx" ? " (lokalizacja przybliżona)" : p.locationPrecision === "unknown" ? " (brak współrzędnych)" : "";
  const links = p.links
    .filter((l) => l.active)
    .map((l) => `<a href="${escapeHtml(l.url)}">${SOURCE_LABELS[l.source as Source] ?? l.source}</a>`);
  if (links.length === 0) links.push(`<a href="${escapeHtml(p.primaryUrl)}">Oferta</a>`);
  if (opts.appBaseUrl) links.push(`<a href="${escapeHtml(`${opts.appBaseUrl}/?focus=${p.id}`)}">Mapa</a>`);
  const title = p.title.length > 90 ? `${p.title.slice(0, 87)}…` : p.title;
  const lines = [
    `${icon} <b>${escapeHtml(head)}</b>${extras.length ? ` · ${escapeHtml(extras.join(" · "))}` : ""}`,
    `<i>${escapeHtml(title)}</i>`,
    `💰 ${escapeHtml(priceParts.join(" · "))}`,
    `📍 ${escapeHtml([where || "—", dist].filter(Boolean).join(" · "))}${approx}`,
    `🔗 ${links.join(" · ")} · dodano ${formatDateWarsaw(p.firstSeenAt)}`,
  ];
  return lines.join("\n");
}

export function formatDigest(items: PropertyRow[], opts: DigestOptions): string {
  const header =
    opts.chunkCount > 1
      ? `🆕 Nowe oferty: ${opts.total} (część ${opts.chunkIndex + 1}/${opts.chunkCount})`
      : `🆕 Nowe oferty: ${opts.total}`;
  return [header, ...items.map((p) => formatPropertyLine(p, opts))].join("\n\n");
}

export function formatSummary(count: number, appBaseUrl: string): string {
  const link = appBaseUrl ? `\n<a href="${escapeHtml(`${appBaseUrl}/?addedWithinDays=1`)}">Pokaż nowe na mapie</a>` : "";
  return `📦 Duża partia: ${count} nowych ofert naraz (bez szczegółów, żeby nie zalewać czatu).${link}`;
}

export function formatTestMessage(): string {
  return "✅ Land Finder: powiadomienia działają.";
}

export function formatWarning(text: string): string {
  return `⚠️ Land Finder: ${escapeHtml(text)}`;
}
