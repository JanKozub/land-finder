import { TZDate } from "@date-fns/tz";

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Parses "1 900 m²", "163,49 m²", "0,09 ha" style labels into a number (m² for ha converted). */
export function parseAreaLabel(label: unknown): number | null {
  const s = asString(label);
  if (!s) return null;
  const m = s.replace(/\s/g, "").match(/^([\d.,]+)(m²|m2|ha|ar|a)?/i);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "ha") return n * 10_000;
  if (unit === "ar" || unit === "a") return n * 100;
  return n;
}

export function parseIsoDate(v: unknown): Date | null {
  const s = asString(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** Otodom emits "2026-10-03 22:12:24" without a zone; it is Europe/Warsaw local time. */
export function parseWarsawLocal(v: unknown): Date | null {
  const s = asString(v);
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) return parseIsoDate(s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return parseIsoDate(s);
  const [, y, mo, d, h, mi, se] = m;
  const tz = new TZDate(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se), "Europe/Warsaw");
  return new Date(tz.getTime());
}

export function stripHtml(v: unknown, maxLen = 500): string | null {
  const s = asString(v);
  if (!s) return null;
  const text = s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, maxLen) : null;
}

export function isHttpsUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\/[^\s]+$/.test(v);
}

export function round2(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}

export function pricePerM2(price: number | null, area: number | null): number | null {
  if (price === null || area === null || area <= 0) return null;
  return round2(price / area);
}
