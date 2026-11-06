/**
 * A signed Storage link changes on every server render (its token is new each time), so a page that re-renders
 * (live updates, router.refresh) would download the same photo again. `sameImage` tells whether two signed links
 * point at the same file and version: everything but the `token` parameter matches.
 */
export function sameImage(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const x = new URL(a);
    const y = new URL(b);
    x.searchParams.delete('token');
    y.searchParams.delete('token');
    return x.toString() === y.toString();
  } catch {
    return false;
  }
}
