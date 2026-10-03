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
