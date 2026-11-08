/**
 * Removes secrets from a URL or route before it is sent anywhere: drops the query string and hash
 * (sign-in codes, access tokens), replaces invite tokens with `[token]` and ids with `[id]`, so
 * reports group by screen rather than by client or workout.
 */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  const base = cut === -1 ? url : url.slice(0, cut);
  return base
    .replace(/(^|\/)invite\/[^/]+/, '$1invite/[token]')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/[id]')
    .replace(/\/\d+(?=\/|$)/g, '/[id]');
}
