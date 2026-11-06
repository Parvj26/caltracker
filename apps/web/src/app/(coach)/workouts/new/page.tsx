import type { Metadata } from 'next';
import Link from 'next/link';
import { emptyWorkout } from '@caltracker/shared';
import { WorkoutBuilder } from '@/components/workout-builder/workout-builder';
import { requireCoach } from '@/lib/auth';
import styles from '../workouts.module.css';

export const metadata: Metadata = { title: 'New workout · Workouts' };

export default async function NewWorkoutPage() {
  const { units, workspaceId } = await requireCoach();
  // The id is made here so the first save creates the row; later saves update it.
  const initial = emptyWorkout(() => crypto.randomUUID());
  return (
    <div className={styles.page}>
      <Link href="/workouts" className={styles.back}>← Workouts</Link>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>New workout</h1>
      </header>
      <WorkoutBuilder initial={initial} units={units} workspaceId={workspaceId} mode="library" isNew />
    </div>
  );
}
