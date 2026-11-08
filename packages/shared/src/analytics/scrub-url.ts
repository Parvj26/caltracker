/**
 * Removes secrets from a URL or route before it is sent anywhere: drops the query string and hash
 * (sign-in codes, access tokens) and replaces invite tokens with `[token]`.
 */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  const base = cut === -1 ? url : url.slice(0, cut);
  return base.replace(/(^|\/)invite\/[^/]+/, '$1invite/[token]');
}
