/** The phone tab bar's tabs. More opens the sheet with every other page. */
export type TabId = 'home' | 'clients' | 'messages' | 'programs' | 'more';

const TAB_PATHS: Record<Exclude<TabId, 'more'>, string> = {
  home: '/home',
  clients: '/clients',
  messages: '/messages',
  programs: '/programs',
};

/** The pages reached through More (its sheet), so More is the current tab on them. */
const MORE_PATHS = ['/workouts', '/exercises', '/meals', '/activity', '/community', '/profile', '/help'];

const within = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** Which tab to highlight for a page: its own tab, More for a page in the More sheet, or none. */
export function currentTab(pathname: string): TabId | null {
  for (const [id, href] of Object.entries(TAB_PATHS) as [TabId, string][]) {
    if (within(pathname, href)) return id;
  }
  return MORE_PATHS.some((href) => within(pathname, href)) ? 'more' : null;
}
