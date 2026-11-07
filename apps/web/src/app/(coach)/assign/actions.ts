'use server';

import { revalidatePath } from 'next/cache';
import { AssignToClientsInput, addDays, compareByLastName, localToday } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { assignOne, copyOne, scheduleOne, todayError, GENERIC } from '@/lib/assign';
import { requireCoach } from '@/lib/auth';
import { readAll } from '@/lib/coach-home';
import { createServerSupabase } from '@/lib/supabase/server';

// "Assign" from the library (and Home): one workout or program onto several clients' calendars at once. The workspace
// always comes from requireCoach(); every read is under the coach's own session (RLS), and every write goes through
// schedule_workout or assign_program, which check again that the caller coaches the workspace and each client is a
// current client.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Clients assigned at the same time: enough to be quick, few enough not to crowd the database. */
const PARALLEL = 4;

export type AssignClient = { id: string; firstName: string; lastName: string };
export type ScheduledDay = { clientId: string; date: IsoDate; name: string };
export type AssignProgramShape = { id: string; name: string; weeks: number; slots: { week: number; day: number }[] };
export type AssignTargets = {
  /** Current clients, by last name. */
  clients: AssignClient[];
  /** What is already on their calendars from 8 days back on (clash warnings and each client's next free day). */
  scheduled: ScheduledDay[];
  /** The program being assigned, with its slots, for the clash warning. */
  program: AssignProgramShape | null;
};

/** Everything the Assign dialog needs, loaded when it opens (a few queries, never one per client). */
export async function loadAssignTargets(input: { programId?: string | null } = {}): Promise<AssignTargets> {
  const { workspaceId } = await requireCoach();
  const programId = input.programId ?? null;
  if (programId !== null && !UUID.test(programId)) throw new Error('Invalid program');
  const supabase = await createServerSupabase();

  const [members, scheduled, program] = await Promise.all([
    // Current clients only: a removed client is no longer a workspace member.
    supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'client'),
    readAll(
      (from, to) =>
        supabase
          .from('workouts')
          .select('client_id, name, scheduled_on')
          .eq('workspace_id', workspaceId)
          .not('client_id', 'is', null)
          // A program may start up to 7 days back, plus a day for the browser's time zone.
          .gte('scheduled_on', addDays(localToday('UTC'), -8))
          .order('scheduled_on')
          .order('id')
          .range(from, to),
      'scheduled workouts',
    ),
    programId
      ? supabase
          .from('programs')
          .select('id, name, weeks, program_workouts(week, day)')
          .eq('workspace_id', workspaceId)
          .eq('id', programId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (members.error) throw new Error(`Could not load clients: ${members.error.message}`);
  if (program.error) throw new Error(`Could not load the program: ${program.error.message}`);

  const ids = members.data.map((m) => m.user_id);
  const profiles = ids.length ? await supabase.from('profiles').select('id, first_name, last_name').in('id', ids) : { data: [], error: null };
  if (profiles.error) throw new Error(`Could not load client names: ${profiles.error.message}`);
  const nameOf = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const current = new Set(ids);

  return {
    clients: ids
      .map((id) => ({ id, firstName: nameOf.get(id)?.first_name ?? '', lastName: nameOf.get(id)?.last_name ?? '' }))
      .sort(compareByLastName),
    scheduled: scheduled.flatMap((w) =>
      w.client_id && w.scheduled_on && current.has(w.client_id) ? [{ clientId: w.client_id, date: w.scheduled_on, name: w.name }] : [],
    ),
    program: program.data
      ? {
          id: program.data.id,
          name: program.data.name,
          weeks: program.data.weeks,
          slots: program.data.program_workouts.map((s) => ({ week: s.week, day: s.day })),
        }
      : null,
  };
}

export type ClientResult = { clientId: string } & ({ ok: true; count: number } | { ok: false; error: string });

/**
 * Puts one library workout (or program, or for Copy to… a client's calendar workout) on each target client's calendar, on that client's day. Each client is one
 * database call, all or nothing for that client; one client failing doesn't stop the others. Answers per client, in
 * the order sent. A refusal for the whole request (bad input, a wrong device date) comes back as { ok: false }.
 */
export async function assignToClients(
  input: AssignToClientsInput,
): Promise<{ ok: true; results: ClientResult[] } | { ok: false; error: string }> {
  await requireCoach();
  const parsed = AssignToClientsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Pick at least one client and a valid date.' };
  const { kind, sourceId, today, targets } = parsed.data;
  const badToday = todayError(today);
  if (badToday) return { ok: false, error: badToday };

  const supabase = await createServerSupabase();
  const one = async (t: (typeof targets)[number]): Promise<ClientResult> => {
    try {
      if (kind === 'copy') {
        const r = await copyOne(supabase, { newId: t.id, sourceId, clientId: t.clientId, date: t.date, today });
        return r.ok ? { clientId: t.clientId, ok: true, count: 1 } : { clientId: t.clientId, ok: false, error: r.error };
      }
      if (kind === 'workout') {
        const r = await scheduleOne(supabase, { newId: t.id, workoutId: sourceId, clientId: t.clientId, date: t.date, today });
        return r.ok ? { clientId: t.clientId, ok: true, count: 1 } : { clientId: t.clientId, ok: false, error: r.error };
      }
      const r = await assignOne(supabase, { assignmentId: t.id, programId: sourceId, clientId: t.clientId, startDate: t.date, today });
      return r.ok ? { clientId: t.clientId, ok: true, count: r.count } : { clientId: t.clientId, ok: false, error: r.error };
    } catch {
      return { clientId: t.clientId, ok: false, error: GENERIC };
    }
  };

  const results: ClientResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const i = next++;
      results[i] = await one(targets[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, targets.length) }, worker));

  if (results.some((r) => r.ok)) {
    revalidatePath('/clients/[clientId]', 'layout');
    revalidatePath('/home');
  }
  return { ok: true, results };
}
