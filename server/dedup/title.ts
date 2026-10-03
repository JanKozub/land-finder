export function dice<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

export function charBigrams(s: string): Set<string> {
  const compact = s.replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i < compact.length - 1; i += 1) out.add(compact.slice(i, i + 2));
  return out;
}

/** Similarity in [0,1] between two normalized titles, or null when either carries too little information. */
export function titleSimilarity(aNorm: string, bNorm: string): number | null {
  const ta = aNorm.split(" ").filter(Boolean);
  const tb = bNorm.split(" ").filter(Boolean);
  if (ta.length < 2 || tb.length < 2) return null;
  const tokenDice = dice(new Set(ta), new Set(tb));
  const bigramDice = dice(charBigrams(aNorm), charBigrams(bNorm));
  return Math.max(tokenDice, bigramDice);
}
