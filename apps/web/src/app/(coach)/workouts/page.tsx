import type { Metadata } from 'next';
import Link from 'next/link';
import { countExercises } from '@caltracker/shared';
import { DuplicateButton } from '@/components/duplicate-button';
import { Button, ButtonLink, Card, TextField } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { escapeLike } from '../exercises/filters';
import { LocalDate } from './local-date';
import styles from './workouts.module.css';

export const metadata: Metadata = { title: 'Workouts' };

// Libraries stay small in V1; past this the list says so instead of paging.
const LIMIT = 200;

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function WorkoutsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workspaceId } = await requireCoach();
  const q = one((await searchParams).q).trim().slice(0, 100);

  const supabase = await createServerSupabase();
  let query = supabase
    .from('workouts')
    .select('id, name, updated_at, workout_blocks(kind, workout_exercises(id))')
    .eq('workspace_id', workspaceId)
    .is('client_id', null);
  if (q) query = query.ilike('name', `%${escapeLike(q)}%`);
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(LIMIT + 1);
  if (error) throw new Error(`Could not load workouts: ${error.message}`);
  const rows = data.slice(0, LIMIT).map((w) => ({
    id: w.id,
    name: w.name,
    updatedAt: w.updated_at,
    // A pick-one group counts once: the client does one of its options.
    exercises: countExercises(w.workout_blocks.map((b) => ({ kind: b.kind, exercises: b.workout_exercises.length }))),
  }));

  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Workouts</h1>
          <p className={styles.caption}>
            A workout is one session: exercises, sets, reps and rest. Build them here, then add them to programs or
            straight to a client&apos;s calendar.
          </p>
        </div>
        <div className={styles.titleActions}>
          <ButtonLink href="/workouts/new">New workout</ButtonLink>
        </div>
      </header>

      <Card className={styles.searchCard}>
        <form method="get" action="/workouts" className={styles.searchRow} role="search">
          <TextField label="Search" type="search" name="q" defaultValue={q} className={styles.searchField} />
          <Button type="submit">Search</Button>
        </form>
      </Card>

      {rows.length === 0 ? (
        <p className={styles.empty}>{q ? 'No workouts match.' : 'No workouts yet. Build your first one.'}</p>
      ) : (
        <Card className={styles.listCard}>
          <table className={styles.table} aria-label="Workouts">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Exercises</th>
                <th scope="col">Updated</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td>
                    <Link href={`/workouts/${w.id}`} className={styles.nameLink}>
                      {w.name}
                    </Link>
                  </td>
                  <td className={styles.numeric}>{w.exercises}</td>
                  <td className={styles.numeric}>
                    <LocalDate iso={w.updatedAt} />
                  </td>
                  <td>
                    <DuplicateButton kind="workout" id={w.id} name={w.name} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > LIMIT ? (
            <p className={styles.caption}>Showing the {LIMIT} most recently updated. Search to find others.</p>
          ) : null}
        </Card>
      )}
    </div>
  );
}
