/**
 * Nuxt 3 embeds its SSR payload as a devalue-flattened array in `<script id="__NUXT_DATA__">`:
 * every value is an index into the array, typed values are `["Type", ...]` tuples.
 */
const UNDEFINED = -1;
const HOLE = -2;
const NAN = -3;
const POS_INF = -4;
const NEG_INF = -5;
const NEG_ZERO = -6;

export function unflattenDevalue(values: unknown[]): unknown {
  if (!Array.isArray(values) || values.length === 0) throw new Error("invalid devalue payload");
  const hydrated: unknown[] = new Array(values.length);
  const done: boolean[] = new Array(values.length).fill(false);
  const hydrate = (index: number): unknown => {
    if (index === UNDEFINED) return undefined;
    if (index === NAN) return NaN;
    if (index === POS_INF) return Infinity;
    if (index === NEG_INF) return -Infinity;
    if (index === NEG_ZERO) return -0;
    if (done[index]) return hydrated[index];
    const value = values[index];
    done[index] = true;
    if (!value || typeof value !== "object") {
      hydrated[index] = value;
    } else if (Array.isArray(value)) {
      if (typeof value[0] === "string") {
        const type = value[0];
        switch (type) {
          case "Date":
            hydrated[index] = new Date(value[1] as string);
            break;
          case "Set": {
            const s = new Set<unknown>();
            hydrated[index] = s;
            for (let i = 1; i < value.length; i++) s.add(hydrate(value[i] as number));
            break;
          }
          case "Map": {
            const m = new Map<unknown, unknown>();
            hydrated[index] = m;
            for (let i = 1; i < value.length; i += 2) m.set(hydrate(value[i] as number), hydrate(value[i + 1] as number));
            break;
          }
          case "RegExp":
            hydrated[index] = new RegExp(value[1] as string, value[2] as string | undefined);
            break;
          case "Object":
            hydrated[index] = Object(value[1]);
            break;
          case "BigInt":
            hydrated[index] = BigInt(value[1] as string);
            break;
          case "null": {
            const obj: Record<string, unknown> = Object.create(null);
            hydrated[index] = obj;
            for (let i = 1; i < value.length; i += 2) obj[value[i] as string] = hydrate(value[i + 1] as number);
            break;
          }
          case "EmptyRef":
          case "EmptyShallowRef":
            hydrated[index] = value[1] === "_" ? undefined : JSON.parse(value[1] as string);
            break;
          default:
            // Nuxt revivers (Ref, ShallowRef, Reactive, ShallowReactive, NuxtError, …) wrap a single value.
            hydrated[index] = hydrate(value[1] as number);
        }
      } else {
        const arr: unknown[] = new Array(value.length);
        hydrated[index] = arr;
        for (let i = 0; i < value.length; i++) {
          const n = value[i] as number;
          if (n === HOLE) continue;
          arr[i] = hydrate(n);
        }
      }
    } else {
      const obj: Record<string, unknown> = {};
      hydrated[index] = obj;
      for (const [key, idx] of Object.entries(value as Record<string, number>)) obj[key] = hydrate(idx);
    }
    return hydrated[index];
  };
  return hydrate(0);
}

/** Decoded `__NUXT_DATA__` payload of a page, or null when the script is missing or malformed. */
export function extractNuxtData(html: string): unknown {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return unflattenDevalue(JSON.parse(m[1]!) as unknown[]);
  } catch {
    return null;
  }
}

/** `data["<prefix>…"]` of a decoded payload (the key suffix is the request path, which we do not reproduce exactly). */
export function nuxtDataByPrefix(payload: unknown, prefix: string): unknown {
  const root = payload as { data?: Record<string, unknown> } | null;
  const data = root?.data;
  if (!data || typeof data !== "object") return null;
  const key = Object.keys(data).find((k) => k.startsWith(prefix));
  return key ? data[key] : null;
}
