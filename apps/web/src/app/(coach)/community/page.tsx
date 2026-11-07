import type { Metadata } from 'next';
import { memberName } from '@caltracker/shared';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { LiveRefresh } from '@/components/live-refresh';
import { requireCoach } from '@/lib/auth';
import { renderTime } from '@/lib/live-refresh';
import { createServerSupabase } from '@/lib/supabase/server';
import { Composer } from './composer';
import { loadCommunity } from './data';
import { Members } from './members';
import { PostCard } from './post-card';
import styles from './community.module.css';

export const metadata: Metadata = { title: 'Community' };

export default async function CommunityPage() {
  const coach = await requireCoach();
  const supabase = await createServerSupabase();
  const data = await loadCommunity(supabase, coach.workspaceId);
  const now = renderTime();
  const viewer = { userId: coach.userId, name: memberName({ firstName: coach.firstName, lastName: coach.lastName }) };

  if (!data) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Community</h1>
        <p className={styles.caption}>Your community isn’t set up yet. Please contact support.</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Community</h1>
          <p className={styles.caption}>A private space for you and your clients. Members only see each other’s name and photo.</p>
        </div>
        <Link href="/community/reports" className={styles.smallButton}>
          Reports{data.openReports > 0 ? ` (${data.openReports})` : ''}
        </Link>
      </header>

      <div className={styles.layout}>
        <div className={styles.feed}>
          <Composer communityId={data.communityId} workspaceId={coach.workspaceId} userId={coach.userId} />
          {data.posts.length === 0 ? (
            <Card>
              <p className={styles.caption}>No posts yet. Say hello to kick things off — your clients get a notification.</p>
            </Card>
          ) : (
            data.posts.map((p) => <PostCard key={p.id} post={p} viewer={viewer} units={coach.units} now={now} />)
          )}
        </div>
        <Members communityId={data.communityId} members={data.members} />
      </div>

      <LiveRefresh
        on={[
          // Deletes arrive as an update of the community row (activity_at).
          { table: 'communities', filter: `id=eq.${data.communityId}` },
          { table: 'community_posts', filter: `workspace_id=eq.${coach.workspaceId}` },
          { table: 'community_comments', filter: `workspace_id=eq.${coach.workspaceId}` },
          { table: 'community_reactions', filter: `workspace_id=eq.${coach.workspaceId}` },
          { table: 'community_reports', filter: `workspace_id=eq.${coach.workspaceId}` },
        ]}
        renderedAt={now}
        maxWaitMs={4000}
      />
    </div>
  );
}
