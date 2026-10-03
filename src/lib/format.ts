import type { Kind } from "@shared/constants";

const pln = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" });
const dateOnly = new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Warsaw" });

export function formatPln(n: number | null | undefined): string {
  return n === null || n === undefined ? "cena do uzgodnienia" : `${pln.format(n)} zł`;
}

export function formatPricePerM2(n: number | null | undefined): string | null {
  return n === null || n === undefined ? null : `${pln.format(Math.round(n))} zł/m²`;
}

export function formatArea(m2: number | null | undefined, kind: Kind = "plot"): string {
  if (m2 === null || m2 === undefined) return "pow. nieznana";
  const base = `${pln.format(Math.round(m2))} m²`;
  return kind === "plot" && m2 >= 100 ? `${base} (${dec1.format(m2 / 100)} a)` : base;
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : "—";
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateOnly.format(new Date(iso)) : "—";
}

export function formatKm(km: number): string {
  return `${dec1.format(km)} km`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "przed chwilą";
  if (min < 60) return `${min} min temu`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h temu`;
  return `${Math.round(h / 24)} dni temu`;
}
