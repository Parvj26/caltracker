/** Pages a confirmed email link may land on. Anything else falls back to the first entry's default. */
const ALLOWED_NEXT = new Set(['/set-password', '/clients']);
export const DEFAULT_NEXT = '/clients';

/**
 * Turns the untrusted `next` query value into one of the allowlisted paths.
 * Defence in depth: the raw value must be on the allowlist, and it must also resolve to the same origin
 * (the URL parser strips tab/CR/LF, so `/%09/evil.com` would otherwise become `//evil.com`).
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT;
  try {
    const base = 'http://caltracker.invalid';
    const resolved = new URL(next, base);
    if (resolved.origin !== base) return DEFAULT_NEXT;
    if (ALLOWED_NEXT.has(next) && ALLOWED_NEXT.has(resolved.pathname)) return resolved.pathname;
  } catch {
    // fall through
  }
  return DEFAULT_NEXT;
}
