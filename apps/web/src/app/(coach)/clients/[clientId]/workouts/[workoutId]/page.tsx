import Link from 'next/link';
import { notFound } from 'next/navigation';
import { WorkoutBuilder } from '@/components/workout-builder/workout-builder';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadWorkoutDoc } from '@/lib/workouts';
import { loadClient } from '../../client';
import styles from '@/components/calendar/calendar.module.css';

/** One client's copy of a workout, in the builder. Saving it never changes the library workout it came from. */
export default async function ClientWorkoutPage({ params }: { params: Promise<{ clientId: string; workoutId: string }> }) {
  const { workspaceId, units } = await requireCoach();
  const { clientId, workoutId } = await params;
  const supabase = await createServerSupabase();
  const [client, loaded] = await Promise.all([
    loadClient(supabase, workspaceId, clientId),
    loadWorkoutDoc(supabase, workoutId),
  ]);
  // RLS already limits workouts to this coach's workspace; the copy must also belong to this client, who must still
  // be a client (a past client's calendar is read-only).
  if (!client || client.removedAt !== null || !loaded || loaded.clientId !== client.id || !loaded.scheduledOn) notFound();

  return (
    <div className={styles.page}>
      <Link href={`/clients/${client.id}?month=${loaded.scheduledOn.slice(0, 7)}`} className={styles.back}>
        ← {client.name}&apos;s calendar
      </Link>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>{loaded.doc.name}</h1>
      </header>
      {/* key: opening a different workout starts a fresh builder. */}
      <WorkoutBuilder
        key={loaded.doc.id}
        initial={loaded.doc}
        units={units}
        mode={{ clientName: client.name, date: loaded.scheduledOn }}
      />
    </div>
  );
}
