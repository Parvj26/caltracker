import Link from 'next/link';
import { ButtonLink, Card } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import styles from './programs.module.css';

// Program lists stay small in V1; past this the list says so instead of paging.
const LIMIT = 200;

export default async function ProgramsPage() {
  const { workspaceId } = await requireCoach();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('programs')
    .select('id, name, weeks, program_workouts(count)')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(LIMIT + 1);
  if (error) throw new Error(`Could not load programs: ${error.message}`);
  const rows = data.slice(0, LIMIT).map((p) => ({
    id: p.id,
    name: p.name,
    weeks: p.weeks,
    slots: p.program_workouts[0]?.count ?? 0,
  }));

  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>Programs</h1>
        <p className={styles.caption}>Weeks of library workouts, ready to assign to a client from a start date.</p>
        <div className={styles.titleActions}>
          <ButtonLink href="/programs/new">New program</ButtonLink>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className={styles.empty}>No programs yet. Build your first one.</p>
      ) : (
        <Card className={styles.listCard}>
          <table className={styles.table} aria-label="Programs">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Weeks</th>
                <th scope="col">Workouts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/programs/${p.id}`} className={styles.nameLink}>
                      {p.name}
                    </Link>
                  </td>
                  <td className={styles.numeric}>{p.weeks}</td>
                  <td className={styles.numeric}>{p.slots}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > LIMIT ? <p className={styles.caption}>Showing the {LIMIT} most recently updated.</p> : null}
        </Card>
      )}
    </div>
  );
}
