/** The phone tab bar's tabs. Library opens the Workouts / Exercises / Programs sheet; More opens every other page. */
export type TabId = 'home' | 'clients' | 'library' | 'messages' | 'more';

const TAB_PATHS: Record<'home' | 'clients' | 'messages', string> = {
  home: '/home',
  clients: '/clients',
  messages: '/messages',
};

/** The pages behind Library (the sidebar item and the phone tab), detail pages included. */
const LIBRARY_PATHS = ['/workouts', '/exercises', '/programs'];

/** The pages reached through More (its sheet), so More is the current tab on them. */
const MORE_PATHS = ['/meals', '/activity', '/community', '/profile', '/help'];

const within = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export const isLibraryPath = (pathname: string) => LIBRARY_PATHS.some((href) => within(pathname, href));

/** Which tab to highlight for a page: its own tab, Library or More for the pages behind them, or none. */
export function currentTab(pathname: string): TabId | null {
  for (const [id, href] of Object.entries(TAB_PATHS) as [TabId, string][]) {
    if (within(pathname, href)) return id;
  }
  if (isLibraryPath(pathname)) return 'library';
  return MORE_PATHS.some((href) => within(pathname, href)) ? 'more' : null;
}
