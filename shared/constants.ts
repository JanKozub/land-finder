/** Portals with the generic "location + radius" settings (see PortalSettingsSchema); OLX and Otodom have their own. */
export const PORTAL_SOURCES = ["nieruchomosci_online", "morizon", "gratka", "domiporta", "adresowo"] as const;
export type PortalSource = (typeof PORTAL_SOURCES)[number];

export const SOURCES = ["olx", "otodom", ...PORTAL_SOURCES] as const;
export type Source = (typeof SOURCES)[number];

export const KINDS = ["plot", "house"] as const;
export type Kind = (typeof KINDS)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  olx: "OLX",
  otodom: "Otodom",
  nieruchomosci_online: "Nieruchomosci-online",
  morizon: "Morizon",
  gratka: "Gratka",
  domiporta: "Domiporta",
  adresowo: "Adresowo",
};

/** OLX "Nieruchomości" sub-categories for sale (verified 2026-10-03). */
export const OLX_CATEGORY: Record<Kind, number> = { plot: 24, house: 18 };

/** Otodom estate slugs used in search URLs. */
export const OTODOM_ESTATE: Record<Kind, string> = { plot: "dzialka", house: "dom" };

/**
 * Radii Otodom's own search form offers (km). Any integer is honoured on the first pages, but for other values every
 * page past the page count of the radius-less query redirects into that smaller result set (verified 2026-10-04 for
 * wielicki/wieliczka: 19 km and 20 km broke on page 6 every time, 25 km did not), so every search uses the next value
 * from this list. Even these values intermittently get the radius-less answer; the adapter re-asks per page.
 */
export const OTODOM_RADII = [0, 5, 10, 15, 25, 50, 75] as const;

/** Smallest radius Otodom supports that still covers `km`. */
export function snapOtodomRadius(km: number): number {
  for (const r of OTODOM_RADII) if (r >= km) return r;
  return OTODOM_RADII[OTODOM_RADII.length - 1]!;
}

/** Commonly used OLX distance values (km); the API accepts any integer. */
export const OLX_DISTANCES = [0, 2, 5, 10, 15, 20, 25, 30, 50, 75, 100] as const;

/** Price bucket edges (PLN) used to keep each OLX query under the ~1000 result cap. Last bucket is open-ended. */
export const OLX_PRICE_BUCKETS: Record<Kind, number[]> = {
  plot: [0, 50_000, 100_000, 150_000, 200_000, 300_000, 500_000, 1_000_000],
  house: [0, 200_000, 400_000, 600_000, 800_000, 1_000_000, 1_500_000, 2_500_000],
};

export const OLX_PAGE_SIZE = 50;
export const OLX_OFFSET_CAP = 1000;
export const OTODOM_PAGE_SIZE = 72;
export const MAX_INCREMENTAL_PAGES = 5;
