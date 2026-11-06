import Link from 'next/link';
import { notFound } from 'next/navigation';
import { addDays, localToday, monthGrid } from '@caltracker/shared';
import { isMonth, shiftMonth } from '@/components/calendar/format';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { ClientCalendar, type AssignmentSummary, type CalendarEntry, type PickerProgram } from './client-calendar';
import { loadClient } from './client';
import { loadProgress } from './progress/load';
import { ProgressSection } from './progress/progress-section';
import styles from '@/components/calendar/calendar.module.css';

// Same cap as the workout library page.
const LIBRARY_LIMIT = 200;

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ month?: string | string[]; assign?: string | string[]; scan?: string | string[] }>;
}) {
  const { workspaceId, units } = await requireCoach();
  const [{ clientId }, query] = await Promise.all([params, searchParams]);
  const supabase = await createServerSupabase();
  const client = await loadClient(supabase, workspaceId, clientId);
  if (!client) notFound();

  // "Today" belongs to the coach's browser, not this (UTC) server. Without ?month= the browser picks the month from
  // its own today, which is at most a day from UTC's, so load the months either side as well.
  const month = isMonth(query.month) ? query.month : null;
  const utcToday = localToday('UTC');
  const firstMonth = month ?? shiftMonth(utcToday.slice(0, 7), -1);
  const lastMonth = month ?? shiftMonth(utcToday.slice(0, 7), 1);
  const rangeStart = monthGrid(firstMonth)[0]![0]!;
  const rangeEnd = monthGrid(lastMonth).at(-1)!.at(-1)!;

  const [workouts, assignments, library, programs, progress] = await Promise.all([
    supabase
      .from('workouts')
      .select('id, name, scheduled_on, assignment_id, program_assignments(program_name), workout_logs(id, finished_at)')
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
    loadProgress(supabase, workspaceId, client.id),
  ]);
  if (workouts.error) throw new Error(`Could not load the calendar: ${workouts.error.message}`);
  if (assignments.error) throw new Error(`Could not load assignments: ${assignments.error.message}`);
  if (library.error) throw new Error(`Could not load workouts: ${library.error.message}`);
  if (programs.error) throw new Error(`Could not load programs: ${programs.error.message}`);

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
  const entries: CalendarEntry[] = workouts.data.flatMap((w) =>
    w.scheduled_on
      ? [
          {
            id: w.id,
            name: w.name,
            date: w.scheduled_on,
            programName: w.program_assignments?.program_name ?? null,
            logId: w.workout_logs[0]?.id ?? null,
          },
        ]
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

  return (
    <div className={styles.page}>
      <Link href="/clients" className={styles.back}>← Clients</Link>
      <ClientCalendar
        client={client}
        month={month}
        entries={entries}
        assignments={summaries}
        library={library.data}
        programs={pickerPrograms}
        openAssign={query.assign === '1'}
      />
      <ProgressSection
        workspaceId={workspaceId}
        client={{ id: client.id, name: client.name }}
        units={units}
        data={progress}
        readOnly={client.removedAt !== null}
        openScan={query.scan === '1'}
      />
    </div>
  );
}
