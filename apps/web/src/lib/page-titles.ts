import { cache } from 'react';
import type { Metadata } from 'next';
import { loadClient } from '@/app/(coach)/clients/[clientId]/client';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// Tab titles for the coach pages. The root layout's template adds " · CalTracker", so a page names only itself and
// where it sits, most specific first: "Maya Patel · Clients" becomes "Maya Patel · Clients · CalTracker". Names are
// read under the coach's own session (row-level security), so another workspace's id gives "Not found", like the page.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = 'Not found';

/** "Upper Body A · Workouts": the parts joined, empty ones left out. */
export const pageTitle = (...parts: (string | null | undefined)[]): Metadata => ({
  title: parts.filter((p): p is string => Boolean(p && p.trim())).join(' · ') || NOT_FOUND,
});

type Named = 'workouts' | 'programs' | 'exercises' | 'workout_logs';

/** The name of one row the coach can see, or null. Cached per request, so a page and its title can share it. */
const nameOf = cache(async (table: Named, id: string): Promise<string | null> => {
  if (!UUID.test(id)) return null;
  await requireCoach();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from(table).select('name').eq('id', id).maybeSingle();
  if (error) return null;
  return data?.name ?? null;
});

const clientName = cache(async (clientId: string): Promise<string | null> => {
  const { workspaceId } = await requireCoach();
  const supabase = await createServerSupabase();
  return (await loadClient(supabase, workspaceId, clientId))?.name ?? null;
});

export async function clientPageTitle(clientId: string): Promise<Metadata> {
  const name = await clientName(clientId);
  return name ? pageTitle(name, 'Clients') : pageTitle(NOT_FOUND);
}

export async function logPageTitle(clientId: string, logId: string): Promise<Metadata> {
  const [client, log] = await Promise.all([clientName(clientId), nameOf('workout_logs', logId)]);
  return client && log ? pageTitle(log, client, 'Clients') : pageTitle(NOT_FOUND);
}

export async function clientWorkoutPageTitle(clientId: string, workoutId: string): Promise<Metadata> {
  const [client, workout] = await Promise.all([clientName(clientId), nameOf('workouts', workoutId)]);
  return client && workout ? pageTitle(`Edit ${workout}`, client, 'Clients') : pageTitle(NOT_FOUND);
}

/** A library workout, program or exercise page: "Upper Body A · Workouts". */
export async function namedPageTitle(table: 'workouts' | 'programs' | 'exercises', id: string, section: string): Promise<Metadata> {
  const name = await nameOf(table, id);
  return name ? pageTitle(name, section) : pageTitle(NOT_FOUND);
}
