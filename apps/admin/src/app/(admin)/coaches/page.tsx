import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/admin.module.css';
import { ActionStatus } from '@/components/confirm-dialog';
import { LocalTime } from '@/components/local-time';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/panel';
import { PeopleSearch } from '@/components/people-search';
import { Pill, type PillTone } from '@/components/pill';
import { requireAdmin } from '@/lib/admin';
import { nameOr } from '@/lib/admin-data';
import { loadPeople } from '@/lib/people';
import { createServerSupabase } from '@/lib/supabase/server';
import { AddCoachForm } from './add-coach-form';
import { DeleteCoachButton } from './delete-coach';

export const metadata: Metadata = { title: 'Coaches' };

const HEALTH: Record<string, { label: string; tone: PillTone }> = {
  good: { label: 'Good', tone: 'lime' },
  quiet: { label: 'Quiet', tone: 'tape' },
  inactive: { label: 'Inactive', tone: 'grey' },
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export default async function CoachesPage() {
  const admin = await requireAdmin();
  // Adding and deleting coaches is for owners only (the database and the admin-coach function refuse anyone else).
  const isOwner = admin.role === 'owner';
  const supabase = await createServerSupabase();
  const [coaches, people] = await Promise.all([supabase.rpc('admin_coaches'), loadPeople()]);
  if (coaches.error) throw new Error(`Could not load coaches: ${coaches.error.message}`);
  const count = new Set(coaches.data.map((c) => c.user_id)).size;

  return (
    <>
      <PageHeader title="Coaches" subtitle={`${plural(count, 'coach')} · client limit comes from their plan`}>
        <PeopleSearch people={people} />
      </PageHeader>
      <ActionStatus>
      {isOwner ? (
        <Panel title="Add a coach">
          <AddCoachForm />
        </Panel>
      ) : null}
      <div className={styles.panel}>
        {coaches.data.length === 0 ? (
          <p className={styles.empty}>No coaches yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>COACH</th><th>CLIENTS / LIMIT</th><th>LAST ACTIVE</th><th>THIS WEEK</th><th>HEALTH</th>{isOwner ? <th><span className="visually-hidden">Actions</span></th> : null}</tr>
              </thead>
              <tbody>
                {coaches.data.map((c) => {
                  const health = HEALTH[c.health] ?? HEALTH.inactive!;
                  return (
                    <tr key={`${c.user_id}-${c.workspace_id}`}>
                      <td>
                        <Link href={`/coaches/${c.user_id}`} className={styles.rowLink}>{nameOr(c.name)}</Link>
                        <span className={styles.cellNote}>
                          {c.workspace_name} · since <LocalTime iso={c.created_at} kind="date" />
                        </span>
                      </td>
                      <td>{c.clients} · No plan yet</td>
                      <td><LocalTime iso={c.last_active} kind="ago" /></td>
                      <td>{plural(c.programs_assigned_7d, 'program')} assigned · {plural(c.messages_7d, 'message')}</td>
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
