/** Where the phone list was when an exercise was opened, so ‹ Exercises and Back return to the same place. */
export type ListReturn = { url: string; y: number; shown: number };

const KEY = 'ct-exercises-list-return';

/** A saved place, or null when it is missing, broken or not an Exercises page address. */
export function parseListReturn(raw: string | null): ListReturn | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const { url, y, shown } = v as Record<string, unknown>;
    if (typeof url !== 'string' || !/^\/exercises(\?|$)/.test(url)) return null;
    if (typeof y !== 'number' || !Number.isFinite(y) || typeof shown !== 'number' || !Number.isFinite(shown)) return null;
    return { url, y, shown };
  } catch {
    return null;
  }
}

// Session storage can be missing or blocked (private mode): then the list simply starts at the top.
export function saveListReturn(place: ListReturn): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(place));
  } catch {
    // ignore
  }
}

export function readListReturn(): ListReturn | null {
  try {
    return parseListReturn(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function clearListReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
