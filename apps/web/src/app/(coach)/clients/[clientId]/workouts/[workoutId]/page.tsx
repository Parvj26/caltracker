import type { Metadata } from 'next';
import { clientWorkoutPageTitle } from '@/lib/page-titles';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { suggestionsForWorkout } from '@caltracker/shared';
import { ProgressionCard } from '@/components/progression-card';
import { WorkoutBuilder } from '@/components/workout-builder/workout-builder';
import { requireCoach } from '@/lib/auth';
import { getClient, getWorkoutDoc } from '@/lib/page-data';
import { loadProgression } from '@/lib/progression';
import { createServerSupabase } from '@/lib/supabase/server';
import styles from '@/components/calendar/calendar.module.css';

export async function generateMetadata({ params }: { params: Promise<{ clientId: string; workoutId: string }> }): Promise<Metadata> {
  const { clientId, workoutId } = await params;
  return clientWorkoutPageTitle(clientId, workoutId);
}

/**
 * One client's copy of a workout, in the builder, on any day (a missed one too). Saving it never changes the library
 * workout it came from. Once the client has finished it, its plan stays as it was so the log still matches it: this
 * opens the log instead, where the coach edits the results (saveWorkout refuses it as well).
 */
export default async function ClientWorkoutPage({ params }: { params: Promise<{ clientId: string; workoutId: string }> }) {
  const { workspaceId, units } = await requireCoach();
  const { clientId, workoutId } = await params;
  const [client, loaded] = await Promise.all([getClient(clientId), getWorkoutDoc(workoutId)]);
  // RLS already limits workouts to this coach's workspace; the copy must also belong to this client, who must still
  // be a client (a past client's calendar is read-only).
  if (!client || client.removedAt !== null || !loaded || loaded.clientId !== client.id || !loaded.scheduledOn) notFound();
  const supabase = await createServerSupabase();
  const done = await supabase
    .from('workout_logs')
    .select('id')
    .eq('workout_id', workoutId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (done.error) throw new Error(`Could not check the workout: ${done.error.message}`);
  if (done.data) redirect(`/clients/${client.id}/logs/${done.data.id}`);
  // Auto progression's suggestions (none when the program has it off). Only a hint: never fail the page over it.
  const exerciseIds = loaded.doc.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId));
  const progression = await loadProgression(supabase, workoutId, exerciseIds).catch(() => ({}));
  const suggestions = suggestionsForWorkout(loaded.doc, progression, units);

  return (
    <div className={styles.page}>
      {/* Back to the days around this workout, in the coach's own calendar view (remembered in a cookie). */}
      <Link href={`/clients/${client.id}/training?from=${loaded.scheduledOn}`} className={styles.back}>
        ← {client.name}&apos;s calendar
      </Link>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>{loaded.doc.name}</h1>
      </header>
      <ProgressionCard doc={loaded.doc} suggestions={suggestions} units={units} />
      {/* key: opening a different workout starts a fresh builder. */}
      <WorkoutBuilder
        key={loaded.doc.id}
        initial={loaded.doc}
        units={units}
        workspaceId={workspaceId}
        mode={{ clientName: client.name, date: loaded.scheduledOn }}
      />
    </div>
  );
}
