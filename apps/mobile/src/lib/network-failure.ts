// Tells a dropped connection (try again later) from an answer the server gave (refused, bad request).
const NETWORK = /network request failed|failed to fetch|network ?error|load failed|timed? ?out|internet connection/i;

/**
 * True when the failure is the connection (no signal), not an answer from the server. Handles the shapes the app sees:
 * PostgREST errors ({ message: 'TypeError: Network request failed', code: '' }), storage-js errors
 * (StorageUnknownError with the same message and no status), and plain TypeErrors from fetch.
 */
export function isNetworkFailure(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const x = e as { name?: unknown; message?: unknown; code?: unknown; status?: unknown; statusCode?: unknown };
  // An error that carries a database code or an HTTP status is an answer from the server.
  if (typeof x.code === 'string' && x.code !== '') return false;
  if (typeof x.status === 'number' && x.status > 0) return false;
  if (typeof x.statusCode === 'string' && x.statusCode !== '') return false;
  return NETWORK.test(`${String(x.name)}: ${String(x.message)}`) || x.status === 0;
}
