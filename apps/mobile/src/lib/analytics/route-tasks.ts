import type { TaskName } from '@caltracker/shared';

export type RouteTaskStep = { action: 'start' | 'complete' | 'abandon'; task: TaskName };

const isWorkoutScreen = (path: string) => path.startsWith('/workout/') || path.startsWith('/log/');

/**
 * Tasks that begin, end or are given up just by reaching a screen. `path` is already scrubbed
 * (e.g. /invite/[token]). Leaving a task's screens without finishing counts as giving up.
 */
export function routeTaskSteps(path: string): RouteTaskStep[] {
  const steps: RouteTaskStep[] = [];
  if (path.startsWith('/invite/')) steps.push({ action: 'start', task: 'join_from_invite' });
  if (path === '/today') steps.push({ action: 'complete', task: 'join_from_invite' });
  if (isWorkoutScreen(path)) steps.push({ action: 'complete', task: 'find_todays_workout' });
  if (path === '/progress') steps.push({ action: 'start', task: 'view_progress' });
  if (path === '/zoo') steps.push({ action: 'complete', task: 'view_progress' });
  if (!isWorkoutScreen(path) && path !== '/today' && path !== '/workouts') steps.push({ action: 'abandon', task: 'find_todays_workout' });
  if (path !== '/progress' && path !== '/zoo') steps.push({ action: 'abandon', task: 'view_progress' });
  return steps;
}

/** Done sets in a workout log (sets with a completion time). */
export function countDoneSets(log: { blocks: { exercises: { sets: { completedAt: string | null }[] }[] }[] }): number {
  let n = 0;
  for (const b of log.blocks) for (const e of b.exercises) for (const s of e.sets) if (s.completedAt !== null) n++;
  return n;
}
