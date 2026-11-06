import { Logo } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { NAV_ICONS } from './nav-icons';
import { loadUnreadTotal } from './messages/data';
import { MessagesNavLink } from './messages-nav-link';
import { NavLink } from './nav-link';
import { createServerSupabase } from '@/lib/supabase/server';
import styles from './coach.module.css';

// Programs arrives with the program builder (phase 2 Task 15); until then it 404s.
const NAV = [
  { href: '/home', label: 'Home', icon: 'home' },
  { href: '/clients', label: 'Clients', icon: 'clients' },
  { href: '/workouts', label: 'Workouts', icon: 'workouts' },
  { href: '/programs', label: 'Programs', icon: 'programs' },
  { href: '/exercises', label: 'Exercises', icon: 'exercises' },
  { href: '/activity', label: 'Activity', icon: 'activity' },
] as const;

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const coach = await requireCoach();
  // A failed count must not take the whole dashboard down; the sidebar badge refetches by itself in the browser.
  const unread = await createServerSupabase()
    .then((supabase) => loadUnreadTotal(supabase, coach.userId))
    .catch(() => 0);
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} data-coach-sidebar="">
        <div className={styles.brand}>
          <Logo className={styles.logoFull} />
          <Logo variant="mark" className={styles.logoMark} />
          <p className={styles.workspace}>{coach.workspaceName}</p>
        </div>
        <nav aria-label="Main" className={styles.nav}>
          {NAV.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
          <MessagesNavLink userId={coach.userId} workspaceId={coach.workspaceId} initial={unread} />
        </nav>
        <form action="/auth/sign-out" method="post" className={styles.signOut}>
          <button type="submit" aria-label="Sign out" className={styles.navItem}>
            {NAV_ICONS.signOut}
            <span className={styles.navLabel}>Sign out</span>
          </button>
        </form>
      </aside>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
