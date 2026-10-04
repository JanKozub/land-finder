import { parse, type HTMLElement } from "node-html-parser";

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", sup2: "²", sup3: "³", deg: "°", ndash: "–", mdash: "—", hellip: "…", zwnj: "", zwj: "" };

/** Decodes numeric and the common named HTML entities; non-breaking/thin spaces become plain spaces. */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[   ]/g, " ");
}

/** Visible text of an element: entities decoded, whitespace collapsed; null when empty. */
export function textOf(el: HTMLElement | null | undefined): string | null {
  if (!el) return null;
  const text = decodeHtmlEntities(el.rawText.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text || null;
}

/** "150 000", "1&nbsp;005", "0,15" → number (comma decimal), null when no digits. */
export function numberIn(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = decodeHtmlEntities(text).replace(/[^\d,.]/g, "").replace(",", ".");
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseDocument(html: string): HTMLElement {
  return parse(html, { blockTextElements: { script: true, style: true, noscript: true, pre: false } });
}

/** Every `<script type="application/ld+json">` payload that parses; invalid blocks are skipped. */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1]!.trim()));
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return out;
}

/** Flattens `@graph` arrays so callers can look for a node by `@type` across all blocks. */
export function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (v && typeof v === "object") {
      const rec = v as Record<string, unknown>;
      nodes.push(rec);
      if (Array.isArray(rec["@graph"])) rec["@graph"].forEach(visit);
    }
  };
  extractJsonLd(html).forEach(visit);
  return nodes;
}

export function hasJsonLdType(node: Record<string, unknown>, type: string): boolean {
  const t = node["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

/** Portals allow several locations separated by commas ("powiat-wielicki, gmina-swiatniki-gorne"). */
export function splitLocations(value: string): string[] {
  const parts = value
    .split(/[,\n;]+/)
    .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return parts.length ? parts : [value.trim()];
}
