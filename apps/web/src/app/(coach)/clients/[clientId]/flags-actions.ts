'use server';

import { revalidatePath } from 'next/cache';
import { addDays, localToday, openFlagsNewestFirst, validateFlag, type ClientFlag, type FlagInput, type IsoDate } from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { loadClientFlags } from '@/lib/client-flag-rows';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadClient } from './client';

// Flags on the client page (Overview card, later the Limitations & injuries tab). Every action starts with
// requireCoach() and takes the workspace from it, never from the browser. RLS does the real checking: only the coach
// of the workspace reads or writes, and only for a current client (a removed client's flags are read-only).

export type FlagOutcome = { ok: true } | ActionFailure;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const refresh = () => revalidatePath('/clients/[clientId]', 'layout');
const refusal = (code: string | undefined) => (code === '42501' ? ('records_client_removed' as const) : ('record_save_failed' as const));

/**
 * The coach's local today, as the browser sent it. The server can't know the coach's time zone, so it accepts any
 * date that is today somewhere on Earth (UTC yesterday to tomorrow).
 */
function checkToday(today: unknown): IsoDate | null {
  if (typeof today !== 'string' || !DATE.test(today)) return null;
  const utc = localToday('UTC');
  return today >= addDays(utc, -1) && today <= addDays(utc, 1) ? today : null;
}

export async function addFlag(clientId: string, input: FlagInput, today: string): Promise<FlagOutcome> {
  const { workspaceId } = await requireCoach();
  const day = checkToday(today);
  if (!UUID.test(clientId) || !day || typeof input !== 'object' || input === null) return fail('request_invalid', 'action:flags.add');
  const checked = validateFlag(
    { region: input.region ?? null, side: String(input.side), type: String(input.type), since: String(input.since), note: String(input.note ?? '') },
    day,
  );
  if (!checked.ok) return fail('field_format', 'action:flags.add');
  const supabase = await createServerSupabase();
  const { error } = await supabase.from('client_flags').insert({ workspace_id: workspaceId, client_id: clientId, ...checked.value });
  if (error) return fail(refusal(error.code), 'action:flags.add');
  refresh();
  return { ok: true };
}

/** Resolved today (the coach's day), or open again (an undo, or the pain came back). */
export async function setFlagResolved(flagId: string, resolved: boolean, today: string): Promise<FlagOutcome> {
  const { workspaceId } = await requireCoach();
  const day = checkToday(today);
  if (!UUID.test(flagId) || typeof resolved !== 'boolean' || !day) return fail('request_invalid', 'action:flags.resolve');
  const supabase = await createServerSupabase();
  const row = resolved ? { status: 'resolved', resolved_on: day } : { status: 'open', resolved_on: null };
  const { data, error } = await supabase.from('client_flags').update(row).eq('id', flagId).eq('workspace_id', workspaceId).select('id');
  if (error) return fail(refusal(error.code), 'action:flags.resolve');
  if (data.length === 0) return fail('note_gone', 'action:flags.resolve');
  refresh();
  return { ok: true };
}

/** One client's first name and open flags, newest first: the builder's reminder inside the "+ New workout" sheet. */
export async function openFlagsFor(clientId: string): Promise<{ firstName: string; flags: ClientFlag[] } | null> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(clientId)) return null;
  const supabase = await createServerSupabase();
  const [client, flags] = await Promise.all([loadClient(supabase, workspaceId, clientId), loadClientFlags(supabase, workspaceId, [clientId], { openOnly: true })]);
  if (!client) return null;
  return { firstName: client.firstName, flags: openFlagsNewestFirst(flags.get(clientId) ?? []) };
}
