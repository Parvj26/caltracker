import type { Metadata } from 'next';
import { clientPageTitle } from '@/lib/page-titles';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import {
  CALENDAR_VIEWS,
  IsoDateSchema,
  WORKOUT_TREE_SELECT,
  addDays,
  coveringRange,
  isCalendarView,
  localToday,
  workoutPreview,
  workoutRowToDoc,
} from '@caltracker/shared';
import type { CalendarView, IsoDate, WorkoutTreeRow } from '@caltracker/shared';
import { isMonth } from '@/components/calendar/format';
import { CALENDAR_VIEW_COOKIE, viewFromCookie } from '@/components/calendar/view-cookie';
import { Conversation } from '../../../../messages/conversation';
import { loadThread } from '../../../../messages/data';
import messageStyles from '../../../../messages/messages.module.css';
import { cx } from '@/components/ui/cx';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { ClientCalendar, type AssignmentSummary, type CalendarEntry, type ClientLogEntry, type PickerProgram } from '../../client-calendar';
import { getClient } from '@/lib/page-data';
import { StickersPanel } from '../../stickers-panel';
import { StrengthPanel } from '../../strength-panel';
import { loadClientStickers } from '@/lib/client-stickers';
import { loadClientStrength } from '@/lib/client-strength';
import { LiveRefresh } from '@/components/live-refresh';
import { renderTime } from '@/lib/live-refresh';
import styles from '@/components/calendar/calendar.module.css';

export async function generateMetadata({ params }: { params: Promise<{ clientId: string }> }): Promise<Metadata> {
  return clientPageTitle((await params).clientId, 'Training');
}

// Same cap as the workout library page.
const LIBRARY_LIMIT = 200;

// Each calendar workout with its exercises (for the week views' previews), program and completed logs. The select
// string is built by concatenation, so supabase-js cannot infer its shape; CalendarRow describes it.
const CALENDAR_SELECT = `${WORKOUT_TREE_SELECT}, program_assignments(program_name), workout_logs(id, finished_at, logged_by)`;
type CalendarRow = WorkoutTreeRow & {
  program_assignments: { program_name: string } | null;
  workout_logs: { id: string; finished_at: string | null; logged_by: string | null }[];
};

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{
    view?: string | string[];
    from?: string | string[];
    month?: string | string[];
    assign?: string | string[];
  }>;
}) {
  const { workspaceId, units, userId } = await requireCoach();
  const [{ clientId }, query] = await Promise.all([params, searchParams]);
  const supabase = await createServerSupabase();
  const client = await getClient(clientId);
  if (!client) notFound();

  // ?view=&from= pick the days on screen. An older ?month=YYYY-MM link opens that month. Without ?view= the view is
  // the one the coach last picked (a cookie), so the first render is already right. "Today" belongs to the coach's
  // browser, not this (UTC) server: without ?from= load around every day the browser's today can be (a day either
  // side of UTC's), and with no view known at all load enough for every view.
  const legacyMonth = isMonth(query.month) ? query.month : null;
  const parsedFrom = IsoDateSchema.safeParse(query.from);
  const remembered = viewFromCookie((await cookies()).get(CALENDAR_VIEW_COOKIE)?.value, userId);
  const view: CalendarView | null = isCalendarView(query.view) ? query.view : legacyMonth ? 'month' : remembered;
  const from: IsoDate | null = parsedFrom.success ? parsedFrom.data : legacyMonth ? `${legacyMonth}-01` : null;
  const utcToday = localToday('UTC');
  const { start: rangeStart, end: rangeEnd } = coveringRange(
    view ? [view] : CALENDAR_VIEWS,
    from ? [from] : [addDays(utcToday, -1), addDays(utcToday, 1)],
  );

  const [workouts, assignments, library, programs, stickers, strength, scheduled, unplanned] = await Promise.all([
    supabase
      .from('workouts')
      .select(CALENDAR_SELECT)
      .eq('workspace_id', workspaceId)
      .eq('client_id', client.id)
      .gte('scheduled_on', rangeStart)
      .lte('scheduled_on', rangeEnd)
      // Completed logs of each planned workout (a discarded or in-progress one is left out), latest first.
      .eq('workout_logs.status', 'completed')
      .order('finished_at', { ascending: false, referencedTable: 'workout_logs' })
      .order('scheduled_on')
      .order('created_at'),
    supabase
      .from('program_assignments')
      .select('id, program_name, start_date, end_date')
      .eq('workspace_id', workspaceId)
      .eq('client_id', client.id)
      .is('cancelled_on', null)
      .gte('end_date', rangeStart)
      .order('start_date'),
    supabase
      .from('workouts')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .is('client_id', null)
      .order('name')
      .limit(LIBRARY_LIMIT),
    supabase
      .from('programs')
      .select('id, name, weeks, program_workouts(week, day)')
      .eq('workspace_id', workspaceId)
      .order('name'),
    loadClientStickers(supabase, workspaceId, client.id),
    loadClientStrength(supabase, workspaceId, client.id),
    // Everything from the earliest day a program may start (7 days back, a day more for time zones) on, so the
    // assign dialog can warn about days that already have a workout, however far ahead the program runs.
    supabase
      .from('workouts')
      .select('name, scheduled_on')
      .eq('workspace_id', workspaceId)
      .eq('client_id', client.id)
      .gte('scheduled_on', addDays(utcToday, -8))
      .order('scheduled_on'),
    // Workouts the client added themselves: completed logs with no planned workout. They have no planned day, so
    // they go on the day they finished in the coach's browser zone (as Activity shows the time); a day either side of
    // the grid covers every zone. The browser picks the day.
    supabase
      .from('workout_logs')
      .select('id, name, finished_at, log_blocks(log_exercises(planned_workout_exercise_id))')
      .eq('workspace_id', workspaceId)
      .eq('client_id', client.id)
      .eq('status', 'completed')
      .is('workout_id', null)
      .gte('finished_at', `${addDays(rangeStart, -1)}T00:00:00Z`)
      .lt('finished_at', `${addDays(rangeEnd, 2)}T00:00:00Z`)
      .order('finished_at'),
  ]);
  if (workouts.error) throw new Error(`Could not load the calendar: ${workouts.error.message}`);
  if (assignments.error) throw new Error(`Could not load assignments: ${assignments.error.message}`);
  if (library.error) throw new Error(`Could not load workouts: ${library.error.message}`);
  if (programs.error) throw new Error(`Could not load programs: ${programs.error.message}`);
  if (unplanned.error) throw new Error(`Could not load client-added workouts: ${unplanned.error.message}`);
  if (scheduled.error) throw new Error(`Could not load scheduled workouts: ${scheduled.error.message}`);

  // Each assignment's dates from yesterday (UTC) on, so the browser can count what "Remove from calendar" removes
  // from its own today.
  const assignmentIds = assignments.data.map((a) => a.id);
  const upcoming = assignmentIds.length
    ? await supabase
        .from('workouts')
        .select('assignment_id, scheduled_on')
        .eq('workspace_id', workspaceId)
        .in('assignment_id', assignmentIds)
        .gte('scheduled_on', addDays(utcToday, -1))
    : { data: [], error: null };
  if (upcoming.error) throw new Error(`Could not load upcoming workouts: ${upcoming.error.message}`);

  // Done is matched by the planned workout (workout_logs.workout_id), never by the log's finish date, so a workout
  // finished at 11 pm in the client's zone stays on its planned day. Only completed logs count: a discarded or
  // in-progress one leaves the workout open (and Missed once its day has passed). The logs come embedded with
  // each workout, so no long id list goes into a URL.
  // "Logged by coach": the log was saved by someone other than the client (a coach of the workspace logging an
  // in-person session). A log whose author's account is gone (logged_by null) says nothing.
  const entries: CalendarEntry[] = (workouts.data as unknown as CalendarRow[]).flatMap((w) => {
    if (!w.scheduled_on) return [];
    const log = w.workout_logs[0];
    return [
      {
        id: w.id,
        name: w.name,
        date: w.scheduled_on,
        programName: w.program_assignments?.program_name ?? null,
        logId: log?.id ?? null,
        loggedByCoach: Boolean(log?.logged_by && log.logged_by !== client.id),
        preview: workoutPreview(workoutRowToDoc(w), units),
      },
    ];
  });
  // A log whose planned workout was deleted since also has no workout_id, but its exercises still point at the plan:
  // that one was planned, not added by the client, so it stays off the calendar with the workout the coach deleted.
  const clientLogs: ClientLogEntry[] = unplanned.data.flatMap((l) =>
    l.finished_at && l.log_blocks.every((b) => b.log_exercises.every((e) => e.planned_workout_exercise_id === null))
      ? [{ id: l.id, name: l.name, finishedAt: l.finished_at }]
      : [],
  );
  const summaries: AssignmentSummary[] = assignments.data.map((a) => ({
    id: a.id,
    programName: a.program_name,
    startDate: a.start_date,
    endDate: a.end_date ?? a.start_date,
    dates: upcoming.data.flatMap((u) => (u.assignment_id === a.id && u.scheduled_on ? [u.scheduled_on] : [])),
  }));
  const pickerPrograms: PickerProgram[] = programs.data.map((p) => ({
    id: p.id,
    name: p.name,
    weeks: p.weeks,
    slots: p.program_workouts.map((s) => ({ week: s.week, day: s.day })),
  }));

  // A past client's chat history stays readable here (read-only).
  const history = client.removedAt !== null ? await loadThread(supabase, workspaceId, userId, client) : null;

  return (
    <div className={styles.page}>
      <LiveRefresh on={[{ table: 'workout_logs', filter: `client_id=eq.${client.id}` }]} renderedAt={renderTime()} />
      {/* The calendar (assign a program, add a workout) comes first; stickers, bests and strength sit below. */}
      <ClientCalendar
        client={client}
        coachId={userId}
        view={view}
        from={from}
        entries={entries}
        clientLogs={clientLogs}
        assignments={summaries}
        library={library.data}
        programs={pickerPrograms}
        upcomingWorkouts={scheduled.data.flatMap((w) => (w.scheduled_on ? [{ date: w.scheduled_on, name: w.name }] : []))}
        openAssign={query.assign === '1'}
      />
      <StickersPanel data={stickers} units={units} />
      <StrengthPanel data={strength} units={units} />
      {history ? (
        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className={styles.historyHeading}>Messages</h2>
          <div className={cx(messageStyles.pane, messageStyles.embedded)}>
            <Conversation
              key={client.id}
              conversationId={history.conversationId}
              workspaceId={workspaceId}
              me={userId}
              clientId={client.id}
              clientName={client.name}
              rows={history.rows}
              theirReadAt={history.theirReadAt}
              readOnly
              embedded
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
