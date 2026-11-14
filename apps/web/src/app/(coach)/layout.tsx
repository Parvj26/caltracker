import { CoachAvatar } from '@/components/coach-avatar';
import { Suspense } from 'react';
import { LegalLinks } from '@/components/legal-links';
import { NavProgress } from '@/components/nav-progress';
import { Logo } from '@/components/ui';
import { coachAvatarUrl } from '@/lib/avatar-url';
import { requireCoach } from '@/lib/auth';
import { AnalyticsProvider } from '@/lib/analytics/provider';
import { SessionReplayGate } from '@/lib/analytics/session-replay-gate';
import { CoachSidebar } from './coach-sidebar';
import type { NavIconName } from './nav-icons';
import { loadUnreadTotal } from './messages/data';
import { MessagesNavLink } from './messages-nav-link';
import { NavLink } from './nav-link';
import { createServerSupabase } from '@/lib/supabase/server';
import styles from './coach.module.css';

// `tab`: on an iPhone the tab bar has it, so the More sheet leaves it out.
const NAV: { href: string; label: string; icon: NavIconName; tab?: boolean }[] = [
  { href: '/home', label: 'Home', icon: 'home', tab: true },
  { href: '/clients', label: 'Clients', icon: 'clients', tab: true },
  { href: '/workouts', label: 'Workouts', icon: 'workouts' },
  { href: '/programs', label: 'Programs', icon: 'programs', tab: true },
  { href: '/exercises', label: 'Exercises', icon: 'exercises' },
  { href: '/meals', label: 'Meals', icon: 'meals' },
  { href: '/activity', label: 'Activity', icon: 'activity' },
  { href: '/community', label: 'Community', icon: 'community' },
];

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const coach = await requireCoach();
  const fullName = `${coach.firstName} ${coach.lastName}`.trim() || coach.email;
  const [avatarUrl, unread] = await Promise.all([
    coachAvatarUrl(),
    // A failed count must not take the whole dashboard down; the sidebar badge refetches by itself in the browser.
    createServerSupabase()
      .then((supabase) => loadUnreadTotal(supabase, coach.workspaceId, coach.userId))
      .catch(() => 0),
  ]);
  const person = { id: coach.userId, name: fullName, email: coach.email, workspaceId: coach.workspaceId, workspaceName: coach.workspaceName };
  return (
    <AnalyticsProvider person={person}>
    {/* Coach pages only: recordings start here when NEXT_PUBLIC_SESSION_REPLAY=on and the PostHog flag allows. */}
    <SessionReplayGate />
    <div className={styles.shell}>
      {/* useSearchParams needs a Suspense boundary; the bar renders nothing until a link is tapped. */}
      <Suspense fallback={null}>
        <NavProgress />
      </Suspense>
      {/* First thing a keyboard user reaches: jumps past the menu to the page itself. */}
      <a href="#main-content" className={styles.skipLink} data-ph-safe="">
        Skip to content
      </a>
      <CoachSidebar userId={coach.userId} workspaceId={coach.workspaceId} initialUnread={unread}>
        <div className={styles.brand}>
          <Logo className={styles.logoFull} />
          <Logo variant="mark" className={styles.logoMark} />
          <p className={styles.workspace}>{coach.workspaceName}</p>
        </div>
        <nav aria-label="Main" className={styles.nav}>
          {NAV.map(({ tab, ...item }) => (
            <NavLink key={item.href} {...item} className={tab ? styles.inTabBar : undefined} />
          ))}
          <MessagesNavLink className={styles.inTabBar} />
        </nav>
        <div className={styles.bottom}>
          {/* Sign out is on the Profile page (it asks first). */}
          <NavLink href="/help" label="Help" icon="help" />
          <NavLink href="/profile" label="Profile" leading={<CoachAvatar url={avatarUrl} name={fullName} seed={coach.userId} />} />
          <LegalLinks className={styles.legal} />
        </div>
      </CoachSidebar>
      <main id="main-content" tabIndex={-1} className={styles.content}>{children}</main>
    </div>
    </AnalyticsProvider>
  );
}
