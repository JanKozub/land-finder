const KEY = "landfinder.lastVisitAt";

/** Returns the previous visit timestamp (ISO) and records the current one. */
export function rotateLastVisit(): string | null {
  try {
    const prev = localStorage.getItem(KEY);
    localStorage.setItem(KEY, new Date().toISOString());
    return prev;
  } catch {
    return null;
  }
}
