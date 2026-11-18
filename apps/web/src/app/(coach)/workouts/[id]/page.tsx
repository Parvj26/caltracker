import type { Metadata } from 'next';
import { workoutPageTitle } from '@/lib/page-titles';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { WorkoutBuilder } from '@/components/workout-builder/workout-builder';
import { requireCoach } from '@/lib/auth';
import { getWorkoutDoc } from '@/lib/page-data';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadExercisePrefs } from '@/lib/workouts';
import { WorkoutPageActions } from './more-actions';
import header from './header.module.css';
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
      {/* The name shows once: the builder's editable title (with the page's h1). Assign and ⋯ sit by the back link. */}
      <div className={header.topRow}>
        <Link href="/workouts" className={styles.back}>← Workouts</Link>
        <WorkoutPageActions id={loaded.doc.id} name={loaded.doc.name} />
      </div>
      {/* key: opening a different workout starts a fresh builder. */}
      <WorkoutBuilder key={loaded.doc.id} initial={loaded.doc} units={units} workspaceId={workspaceId} mode="library" initialPrefs={prefs} pageTitle />
    </div>
  );
}
