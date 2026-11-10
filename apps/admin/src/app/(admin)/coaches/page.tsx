import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/admin.module.css';
import { LocalTime } from '@/components/local-time';
import { PageHeader } from '@/components/page-header';
import { PeopleSearch } from '@/components/people-search';
import { Pill, type PillTone } from '@/components/pill';
import { requireAdmin } from '@/lib/admin';
import { nameOr } from '@/lib/admin-data';
import { loadPeople } from '@/lib/people';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Coaches' };

const HEALTH: Record<string, { label: string; tone: PillTone }> = {
  good: { label: 'Good', tone: 'lime' },
  quiet: { label: 'Quiet', tone: 'tape' },
  inactive: { label: 'Inactive', tone: 'grey' },
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export default async function CoachesPage() {
  await requireAdmin();
  const supabase = await createServerSupabase();
  const [coaches, people] = await Promise.all([supabase.rpc('admin_coaches'), loadPeople()]);
  if (coaches.error) throw new Error(`Could not load coaches: ${coaches.error.message}`);
  const count = new Set(coaches.data.map((c) => c.user_id)).size;

  return (
    <>
      <PageHeader title="Coaches" subtitle={`${plural(count, 'coach')} · client limit comes from their plan`}>
        <PeopleSearch people={people} />
      </PageHeader>
      <div className={styles.panel}>
        {coaches.data.length === 0 ? (
          <p className={styles.empty}>No coaches yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>COACH</th><th>CLIENTS / LIMIT</th><th>LAST ACTIVE</th><th>THIS WEEK</th><th>HEALTH</th></tr>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
