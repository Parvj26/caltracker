import type { Metadata } from 'next';
import { getClient, getExercise, getLog, getProgram, getWorkoutDoc } from '@/lib/page-data';

// Tab titles for the coach pages. The root layout's template adds " · CalTracker", so a page names only itself and
// where it sits, most specific first: "Maya Patel · Clients" becomes "Maya Patel · Clients · CalTracker". The rows
// come from the same request-cached loaders as the pages (lib/page-data), and a title names a row only when the page
// would show it: a log or workout of another client than the one in the URL gets the generic title, like the 404.

const NOT_FOUND = 'Not found';

/** "Upper Body A · Workouts": the parts joined, empty ones left out. */
export const pageTitle = (...parts: (string | null | undefined)[]): Metadata => ({
  title: parts.filter((p): p is string => Boolean(p && p.trim())).join(' · ') || NOT_FOUND,
});

export async function clientPageTitle(clientId: string): Promise<Metadata> {
  const client = await getClient(clientId);
  return client ? pageTitle(client.name, 'Clients') : pageTitle(NOT_FOUND);
}

export async function logPageTitle(clientId: string, logId: string): Promise<Metadata> {
  const [client, loaded] = await Promise.all([getClient(clientId), getLog(logId)]);
  return client && loaded && loaded.clientId === client.id ? pageTitle(loaded.log.name, client.name, 'Clients') : pageTitle(NOT_FOUND);
}

export async function clientWorkoutPageTitle(clientId: string, workoutId: string): Promise<Metadata> {
  const [client, loaded] = await Promise.all([getClient(clientId), getWorkoutDoc(workoutId)]);
  return client && loaded && loaded.clientId === client.id
    ? pageTitle(`Edit ${loaded.doc.name}`, client.name, 'Clients')
    : pageTitle(NOT_FOUND);
}

/** A library workout: never a client's calendar copy (that one is edited from the client's calendar). */
export async function workoutPageTitle(id: string): Promise<Metadata> {
  const loaded = await getWorkoutDoc(id);
  return loaded && loaded.clientId === null ? pageTitle(loaded.doc.name, 'Workouts') : pageTitle(NOT_FOUND);
}

export async function programPageTitle(id: string): Promise<Metadata> {
  const program = await getProgram(id);
  return program ? pageTitle(program.name, 'Programs') : pageTitle(NOT_FOUND);
}

export async function exercisePageTitle(id: string): Promise<Metadata> {
  const exercise = await getExercise(id);
  return exercise ? pageTitle(exercise.name, 'Exercises') : pageTitle(NOT_FOUND);
}
