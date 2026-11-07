import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { addDays, canStartSessionOn, completedSetCount, localToday } from '@caltracker/shared';
import { LiveRefresh } from '@/components/live-refresh';
import { requireCoach } from '@/lib/auth';
import { renderTime } from '@/lib/live-refresh';
import { laterDayNotice, loadLastTimes, loadSessionState } from '@/lib/coach-session';
import { loadProgression } from '@/lib/progression';
import { getClient, getLog, getWorkoutDoc } from '@/lib/page-data';
import { pageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { TrainingNowHost } from '@/components/training-now/training-now-host';
import { loadTrainingNow, pickActivePane } from '@/lib/training-now';
import { ClientLogging } from './client-logging';
import { SessionLogger } from './session-logger';
import styles from './session.module.css';

async function coachName(supabase: Awaited<ReturnType<typeof createServerSupabase>>, id: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('first_name').eq('id', id).maybeSingle();
  return data?.first_name || 'Another coach';
}

export async function generateMetadata({ params }: { params: Promise<{ clientId: string; workoutId: string }> }): Promise<Metadata> {
  const { clientId, workoutId } = await params;
  const [client, loaded] = await Promise.all([getClient(clientId), getWorkoutDoc(workoutId)]);
  return client && loaded && loaded.clientId === client.id ? pageTitle(`Log ${loaded.doc.name}`, client.name, 'Clients') : pageTitle('Not found');
}

/**
 * The coach logs a client's planned workout with them, on the iPad or laptop (spec: coach session logging and single
 * active logger). One person logs a workout at a time: when the client is already logging it on the phone the coach
 * watches, or takes over.
 */
export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string; workoutId: string }>;
  searchParams: Promise<{ with?: string | string[] }>;
}) {
  const { userId, units, workspaceId } = await requireCoach();
  const [{ clientId, workoutId }, query] = await Promise.all([params, searchParams]);
  const [client, workout] = await Promise.all([getClient(clientId), getWorkoutDoc(workoutId)]);
  // RLS limits both to the coach's workspace; the workout must also be on this client's calendar. A past client's
  // calendar is read-only, so there is no session to log.
  if (!client || client.removedAt || !workout || workout.clientId !== client.id) notFound();

  const supabase = await createServerSupabase();
  const state = await loadSessionState(supabase, { clientId: client.id, workoutId, coachId: userId });
  if (state.kind === 'done') redirect(`/clients/${client.id}/logs/${state.logId}`);

  const back = (
    <Link href={`/clients/${client.id}/training`} className={styles.back}>
      ← {client.name}&apos;s calendar
    </Link>
  );

  if (state.kind === 'other_workout') {
    return (
      <div className={styles.page}>
        {back}
        <h1 className={styles.title}>{workout.doc.name}</h1>
        <p className={styles.notice} role="status">
          {state.byCoach
            ? `You have ${state.name} in progress for ${client.firstName}. Finish it first: one workout at a time.`
            : `${client.firstName} has ${state.name} in progress on their phone. They need to finish it first: one workout at a time.`}
        </p>
        <Link href={`/clients/${client.id}/logs/${state.logId}`} className={styles.textLink}>
          Open {state.name}
        </Link>
      </div>
    );
  }

  // Only today's and missed workouts are logged. The server can't know the coach's time zone, so it refuses only
  // what is a later day everywhere (after UTC's tomorrow); the browser and the database refuse the rest.
  if (state.kind === 'start' && !canStartSessionOn(workout.scheduledOn, addDays(localToday('UTC'), 1))) {
    return (
      <div className={styles.page}>
        {back}
        <h1 className={styles.title}>{workout.doc.name}</h1>
        <p className={styles.notice} role="status">
          {laterDayNotice(client.firstName)}
        </p>
      </div>
    );
  }

  const existing = state.kind === 'start' ? null : await getLog(state.logId);
  const log = existing?.log ?? null;
  const exerciseIds = (log ? log.blocks : workout.doc.blocks).flatMap((b) => b.exercises.map((e) => e.exerciseId));
  const [lastTimes, progression] = await Promise.all([
    loadLastTimes(supabase, client.id, exerciseIds),
    loadProgression(supabase, workoutId, exerciseIds),
  ]);

  if ((state.kind === 'client_logging' || state.kind === 'other_coach_logging') && log) {
    // Another coach's name, from their profile (coaches of one workspace can read each other's).
    const holder =
      state.kind === 'client_logging'
        ? { kind: 'client' as const, name: client.firstName || 'Your client' }
        : { kind: 'other_coach' as const, name: await coachName(supabase, state.loggedBy) };
    return (
      <div className={styles.page}>
        {back}
        {/* Live progress: the page re-renders when the log row changes (each save of the phone updates it). */}
        <LiveRefresh on={[{ table: 'workout_logs', filter: `id=eq.${log.id}` }]} renderedAt={renderTime()} />
        <ClientLogging holder={holder} log={log} units={units} done={completedSetCount(log)} />
      </div>
    );
  }

  if (state.kind === 'mine' && log) {
    // The coach's own session, with everyone else training now one tab away (they may log two people at once).
    const now = await loadTrainingNow(supabase, { workspaceId, coachId: userId });
    const active = pickActivePane(now.panes, [typeof query.with === 'string' ? query.with : null, log.id]);
    if (active) {
      return (
        <TrainingNowHost panes={now.panes} inProgressIds={now.inProgressIds} activeLogId={active} workspaceId={workspaceId} units={units} renderedAt={renderTime()} />
      );
    }
  }

  return (
    <div className={styles.wide}>
      {back}
      <SessionLogger
        // A take-over or a new session is a different log: start the screen afresh.
        key={log?.id ?? 'new'}
        client={{ id: client.id, firstName: client.firstName, name: client.name }}
        workout={workout.doc}
        initialLog={log}
        scheduledOn={workout.scheduledOn}
        units={units}
        lastTimes={lastTimes}
        progression={progression}
      />
    </div>
  );
}
