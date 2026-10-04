export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L");
}

/** Words that carry no identity in Polish real-estate titles. */
export const TITLE_STOPWORDS = new Set<string>([
  "dzialka", "dzialki", "dzialke", "dzialek", "budowlana", "budowlane", "budowlany", "budowlanej", "dom", "domu",
  "domy", "domek", "sprzedam", "sprzedaz", "sprzedazy", "sprzeda", "okazja", "pilnie", "oferta", "nieruchomosc",
  "super", "piekna", "piekny", "piekne", "atrakcyjna", "atrakcyjny", "atrakcyjne", "cena", "tanio", "bez", "posrednikow",
  "polecam", "idealna", "idealny", "idealne", "blisko", "centrum", "gmina", "gm", "miejscowosc", "ul", "ulica", "nr",
  "ar", "arow", "ary", "m2", "mkw", "pod", "zabudowe", "jednorodzinna", "jednorodzinny", "wolnostojacy", "wolnostojacy",
  "na", "w", "z", "do", "od", "i", "o", "przy", "oraz", "dla", "to", "ten", "ta", "jest", "lub", "obok", "kolo", "km",
  "min", "minut", "nowy", "nowa", "nowe", "duza", "duzy", "duze", "mala", "maly", "male", "ladna", "ladny", "ladne",
  "widok", "widokowa", "widokiem", "spokojna", "spokojnej", "okolica", "okolicy", "okolice", "cicha", "cichej", "zielona",
  "zieleni", "lasu", "las", "rezerwacja", "mpzp", "wz", "warunki", "pozwolenie", "pnb", "media", "prad", "woda", "gaz",
]);

export function tokenizeTitle(title: string): string[] {
  return stripDiacritics(title.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !TITLE_STOPWORDS.has(t));
}

export function normalizeTitle(title: string): string {
  return [...new Set(tokenizeTitle(title))].join(" ");
}

const GENERIC_ADVERTISERS = new Set(["prywatny", "osoba prywatna", "wlasciciel", "właściciel", "private"]);

/** Stable key identifying the seller across listings of the same portal (null when unknown/generic). */
export function normalizeAdvertiser(name: string | null, id: string | null): string | null {
  if (id && id.trim()) return id.trim().toLowerCase();
  if (!name) return null;
  const n = stripDiacritics(name.trim().toLowerCase()).replace(/\s+/g, " ");
  if (!n || GENERIC_ADVERTISERS.has(n)) return null;
  return n;
}

/** Words that do not identify an agency: legal forms, "real estate", branch markers. */
const SELLER_NOISE = new Set<string>([
  "nieruchomosci", "nieruchomosc", "nieruchomoci", "biuro", "biura", "agencja", "agencji", "posrednictwo", "posrednictwa",
  "obrotu", "obrot", "sp", "zoo", "z", "o", "oo", "sc", "spj", "spk", "sa", "ska", "s", "c", "k", "j", "a", "spolka",
  "group", "grupa", "partners", "partner", "estate", "estates", "realestate", "real", "kancelaria", "firma", "oddzial",
  "oddzialu", "o", "od", "i", "ii", "iii", "iv", "v", "vi", "vii", "nr", "franchise", "franczyza", "ltd", "llc", "gmbh",
  "home", "homes", "house", "dom", "domy", "property", "properties", "invest", "investment", "investments", "rynek",
  "pierwotny", "wtorny", "development", "developer", "deweloper",
]);

/**
 * Identity tokens of an agency name shared across portals, e.g. "BRACIA SADURSCY - ODDZIAŁ I" and
 * "Bracia Sadurscy Oddział BS5 Nowa Huta" both contain ["bracia","sadurscy"]. Empty for private/generic names.
 */
export function sellerTokens(name: string | null): string[] {
  if (!name) return [];
  const n = stripDiacritics(name.toLowerCase());
  if (GENERIC_ADVERTISERS.has(n.trim())) return [];
  const tokens = n.replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length >= 2 && !SELLER_NOISE.has(t));
  return [...new Set(tokens)];
}

/** Same agency when one name's identity tokens are all contained in the other's (branches, legal suffixes differ). */
export function sameSellerTokens(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  const set = new Set(big);
  if (!small.every((t) => set.has(t))) return false;
  // One short token alone ("mb", "n20") is too weak unless it is the whole name on both sides.
  return small.length >= 2 || small.join("").length >= 4 || small.length === big.length;
}

/**
 * Keys that identify the very same advertisement regardless of portal: the Morizon/Gratka internal id (one
 * platform, two sites) and agency CRM reference numbers that feeds carry to several portals.
 */
export function dedupKeysFor(attributes: Record<string, unknown>): string[] {
  const keys = new Set<string>();
  const internal = attributes.internalId;
  if (typeof internal === "number" || (typeof internal === "string" && /^\d+$/.test(internal))) keys.add(`mg:${internal}`);
  for (const field of ["externalId", "offerNumber"]) {
    const raw = attributes[field];
    if (typeof raw !== "string") continue;
    const ref = raw.trim().toLowerCase().replace(/\s+/g, "");
    // Short all-digit references ("0011", "1234") repeat across agencies; keep only distinctive ones.
    if (ref.length >= 5 && (/[^0-9]/.test(ref) || ref.length >= 6)) keys.add(`ref:${ref}`);
  }
  return [...keys];
}

/** Attributes with the current identity keys embedded (stored so candidates can be found by key in SQL). */
export function withDedupKeys(attributes: Record<string, unknown>): Record<string, unknown> {
  const { dedupKeys: _old, ...rest } = attributes;
  const keys = dedupKeysFor(rest);
  return keys.length ? { ...rest, dedupKeys: keys } : rest;
}
