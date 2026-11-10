import type { Metadata } from 'next';
import { workoutPageTitle } from '@/lib/page-titles';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { WorkoutBuilder } from '@/components/workout-builder/workout-builder';
import { requireCoach } from '@/lib/auth';
import { getWorkoutDoc } from '@/lib/page-data';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadExercisePrefs } from '@/lib/workouts';
import { AssignButton } from '@/components/assign/assign-to-clients';
import { DuplicateButton } from '@/components/duplicate-button';
import { DeleteWorkout } from './delete-workout';
import styles from '../workouts.module.css';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return workoutPageTitle((await params).id);
}

export default async function WorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { units, workspaceId } = await requireCoach();
  const { id } = await params;
  const [loaded, prefs] = await Promise.all([
    getWorkoutDoc(id),
    createServerSupabase().then((s) => loadExercisePrefs(s, workspaceId)),
  ]);
  // A client's calendar copy is edited from that client's calendar, not from the library.
  if (!loaded || loaded.clientId !== null) notFound();

  return (
    <div className={styles.page}>
      <Link href="/workouts" className={styles.back}>← Workouts</Link>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>{loaded.doc.name}</h1>
        <div className={styles.titleActions}>
          <AssignButton kind="workout" id={loaded.doc.id} name={loaded.doc.name} />
          <DuplicateButton kind="workout" id={loaded.doc.id} name={loaded.doc.name} />
          <DeleteWorkout id={loaded.doc.id} name={loaded.doc.name} />
        </div>
      </header>
      {/* key: opening a different workout starts a fresh builder. */}
      <WorkoutBuilder key={loaded.doc.id} initial={loaded.doc} units={units} workspaceId={workspaceId} mode="library" initialPrefs={prefs} />
    </div>
  );
}
