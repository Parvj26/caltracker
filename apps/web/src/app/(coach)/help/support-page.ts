/** Where the coach shell remembers the last page before Help (sessionStorage; this tab only). */
export const LAST_PAGE_KEY = 'ct-last-page';

/**
 * The page to name in a support email written from Help: the page the coach was on just before (that is where they
 * got stuck), else Help itself. Origin and path only, never a query string or hash.
 */
export function supportPage(lastPath: string | null, origin: string, pathname: string): string {
  if (lastPath && lastPath.startsWith('/') && !lastPath.startsWith('//')) {
    return `${origin}${lastPath.split(/[?#]/)[0]}`;
  }
  return `${origin}${pathname}`;
}
