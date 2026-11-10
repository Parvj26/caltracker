import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import styles from '@/components/admin.module.css';
import { KpiTile } from '@/components/kpi-tile';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/panel';
import { requireAdmin } from '@/lib/admin';
import { UUID } from '@/lib/actions-shared';
import { fromJson, nameOr, replyTimeLabel, type CoachSummary } from '@/lib/admin-data';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Coach' };

export default async function CoachPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createServerSupabase();
  const [summary, coaches] = await Promise.all([supabase.rpc('admin_coach', { p_user_id: id }), supabase.rpc('admin_coaches')]);
  if (summary.error) {
    if (summary.error.code === 'P0002') notFound();
    throw new Error(`Could not load the coach: ${summary.error.message}`);
  }
  const coach = fromJson<CoachSummary>(summary.data);
  const workspaces = (coaches.data ?? []).filter((c) => c.user_id === id).map((c) => c.workspace_name);
  const programs = coach.programs;

  return (
    <>
      <PageHeader title={nameOr(coach.name)} subtitle={workspaces.length ? `Coach · ${workspaces.join(', ')}` : 'Coach'} />
      <div className={styles.grid4}>
        <KpiTile
          label="CLIENTS"
          value={coach.clients.length}
          note={coach.clients.length ? coach.clients.map((c) => nameOr(c.name).split(' ')[0]).join(', ') : 'none yet'}
        />
        <KpiTile
          label="PROGRAMS"
          value={programs.length}
          note={programs.length ? programs.slice(0, 3).map((p) => `${p.name} · ${p.weeks} week${p.weeks === 1 ? '' : 's'}`).join(', ') : 'none yet'}
        />
        <KpiTile label="MEALS SHARED" value={coach.meals_shared} note={coach.meals_shared ? 'in their library' : 'none yet'} />
        <KpiTile label="REPLY TIME" value={replyTimeLabel(coach.median_reply_minutes_30d)} note="median, last 30 days" />
      </div>
      <Panel title="Clients">
        {coach.clients.length === 0 ? (
          <p className={styles.empty}>No clients yet.</p>
        ) : (
          <ul className={styles.lines}>
            {coach.clients.map((c) => (
              <li key={c.user_id}><Link href={`/clients/${c.user_id}`} className={styles.rowLink}>{nameOr(c.name)}</Link></li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
