/**
 * Reads a list that may be longer than one server answer. Supabase returns at most `max_rows` (1000) rows per request
 * and cuts the rest silently, so the Metrics loaders ask page by page until a page comes back empty. Each next page
 * starts after the rows actually returned, so a server cap smaller than `size` still loses nothing.
 * `page(from, to)` reads rows from..to inclusive (PostgREST .range) in a stable order.
 * Stops with an error after `maxRows`, rather than loading without end.
 */
export async function readAllPages<T>(
  page: (from: number, to: number) => Promise<readonly T[]>,
  size = 1000,
  maxRows = 100_000,
): Promise<T[]> {
  const out: T[] = [];
  for (;;) {
    const rows = await page(out.length, out.length + size - 1);
    if (rows.length === 0) return out;
    out.push(...rows);
    if (out.length >= maxRows) throw new Error(`More than ${maxRows} rows.`);
  }
}
