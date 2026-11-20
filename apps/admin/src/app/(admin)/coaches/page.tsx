import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/admin.module.css';
import { ActionStatus } from '@/components/confirm-dialog';
import { LocalTime } from '@/components/local-time';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/panel';
import { PeopleSearch } from '@/components/people-search';
import { Pill } from '@/components/pill';
import { TestToggle } from '@/components/test-toggle';
import { requireAdmin } from '@/lib/admin';
import { nameOr } from '@/lib/admin-data';
import { coachHealth, coachWeekLabel } from '@/lib/coach-health';
import { NO_PLAN, showTestAccounts, testToggleHref } from '@/lib/owner-overview';
import { loadPeople } from '@/lib/people';
import { createServerSupabase } from '@/lib/supabase/server';
import { AddCoachForm } from './add-coach-form';
import { DeleteCoachButton } from './delete-coach';

export const metadata: Metadata = { title: 'Coaches' };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export default async function CoachesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const showTest = showTestAccounts(sp.test);
  // Adding and deleting coaches is for owners only (the database and the admin-coach function refuse anyone else).
  const isOwner = admin.role === 'owner';
  const supabase = await createServerSupabase();
  const [coaches, people] = await Promise.all([supabase.rpc('admin_coaches'), loadPeople()]);
  if (coaches.error) throw new Error(`Could not load coaches: ${coaches.error.message}`);
  // Test workspaces stay hidden unless "Show test accounts" is on.
  const rows = coaches.data.filter((c) => showTest || !c.is_test);
  const count = new Set(rows.map((c) => c.user_id)).size;

  return (
    <>
      <PageHeader title="Coaches" subtitle={`${plural(count, 'coach')} · client limit comes from their plan`}>
        <div className={styles.headerTools}>
          <TestToggle on={showTest} href={testToggleHref('/coaches', sp, showTest)} />
          <PeopleSearch people={people} />
        </div>
      </PageHeader>
      <ActionStatus>
      {isOwner ? (
        <Panel title="Add a coach">
          <AddCoachForm />
        </Panel>
      ) : null}
      <div className={styles.panel}>
        {rows.length === 0 ? (
          <p className={styles.empty}>No coaches yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>COACH</th><th>CLIENTS / LIMIT</th><th>LAST ACTIVE</th><th>THIS WEEK</th><th>HEALTH</th>{isOwner ? <th><span className="visually-hidden">Actions</span></th> : null}</tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const health = coachHealth(c.health);
                  return (
                    <tr key={`${c.user_id}-${c.workspace_id}`}>
                      <td>
                        <Link href={`/coaches/${c.user_id}`} className={styles.rowLink}>{nameOr(c.name)}</Link>
                        <span className={styles.cellNote}>
                          {c.workspace_name} · since <LocalTime iso={c.created_at} kind="date" />
                        </span>
                      </td>
                      <td>{c.clients} <span className={styles.muted}>· {NO_PLAN}</span></td>
                      <td><LocalTime iso={c.last_active} kind="ago" /></td>
                      <td>{coachWeekLabel(c.workouts_built_week, c.programs_assigned_week)}</td>
                      <td><Pill tone={health.tone}>{health.label}</Pill></td>
                      {isOwner ? (
                        <td>
                          {c.role === 'owner' ? <DeleteCoachButton workspaceId={c.workspace_id} workspaceName={c.workspace_name} /> : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </ActionStatus>
    </>
  );
}
