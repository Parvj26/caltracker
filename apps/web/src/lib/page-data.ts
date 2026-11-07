import { cache } from 'react';
import { loadClient } from '@/app/(coach)/clients/[clientId]/client';
import { requireCoach } from '@/lib/auth';
import { loadLog } from '@/lib/logs';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadWorkoutDoc } from '@/lib/workouts';

// The rows a coach page and its tab title (generateMetadata) both need, cached per request with React's cache(), so
// the title costs no extra query. Everything is read under the coach's own session (row-level security) and the
// workspace comes from requireCoach(), never from the browser.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A current or past client of the coach's workspace, or null. */
export const getClient = cache(async (clientId: string) => {
  const { workspaceId } = await requireCoach();
  return loadClient(await createServerSupabase(), workspaceId, clientId);
});

/** One workout log as a doc (with its client id), or null. */
export const getLog = cache(async (logId: string) => loadLog(await createServerSupabase(), logId));

/** One workout (library or a client's calendar copy) as a doc, or null. */
export const getWorkoutDoc = cache(async (id: string) => {
  await requireCoach();
  return loadWorkoutDoc(await createServerSupabase(), id);
});

/** One of the workspace's programs, or null. */
export const getProgram = cache(async (id: string) => {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id)) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('programs').select('id, name, description, weeks, auto_progression').eq('id', id).eq('workspace_id', workspaceId).maybeSingle();
  if (error) throw new Error(`Could not load program: ${error.message}`);
  return data;
});

/** One exercise the coach can see (the shared library or their own), or null. */
export const getExercise = cache(async (id: string) => {
  await requireCoach();
  if (!UUID.test(id)) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('exercises').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not load exercise: ${error.message}`);
  return data;
});

/** The coach's limitations (injuries) text for a client, or '' (the client page header flags it). */
export const getClientLimitations = cache(async (clientId: string) => {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(clientId)) return '';
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('client_limitations')
    .select('body')
    .eq('workspace_id', workspaceId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(`Could not load limitations: ${error.message}`);
  return data?.body.trim() ?? '';
});
