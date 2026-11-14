import type { Metadata } from 'next';
import { countExercises } from '@caltracker/shared';
import { ButtonLink } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { WorkoutList } from './workout-list';
import styles from './workouts.module.css';

export const metadata: Metadata = { title: 'Workouts' };

// Libraries stay small in V1; past this the list says so instead of paging (and search looks through these).
const LIMIT = 200;

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function WorkoutsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workspaceId } = await requireCoach();
  const q = one((await searchParams).q).trim().slice(0, 100);

  const supabase = await createServerSupabase();
  const query = supabase
    .from('workouts')
    .select('id, name, updated_at, workout_blocks(kind, workout_exercises(id))')
    .eq('workspace_id', workspaceId)
    .is('client_id', null);
  // No name filter here: the list filters in the browser with the shared smart search (typos forgiven), as you type.
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

      <WorkoutList rows={rows} initialQuery={q} limited={data.length > LIMIT} limit={LIMIT} />
    </div>
  );
}
