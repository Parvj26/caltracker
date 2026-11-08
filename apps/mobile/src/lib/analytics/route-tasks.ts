import type { TaskName } from '@caltracker/shared';

export type RouteTaskStep = { action: 'start' | 'complete'; task: TaskName };

/** Tasks that begin or end just by reaching a screen. `path` is already scrubbed (e.g. /invite/[token]). */
export function routeTaskSteps(path: string): RouteTaskStep[] {
  const steps: RouteTaskStep[] = [];
  if (path.startsWith('/invite/')) steps.push({ action: 'start', task: 'join_from_invite' });
  if (path === '/today') steps.push({ action: 'complete', task: 'join_from_invite' });
  if (path.startsWith('/workout/') || path.startsWith('/log/')) steps.push({ action: 'complete', task: 'find_todays_workout' });
  if (path === '/progress') steps.push({ action: 'start', task: 'view_progress' });
  if (path === '/zoo') steps.push({ action: 'complete', task: 'view_progress' });
  return steps;
}

/** Done sets in a workout log (sets with a completion time). */
export function countDoneSets(log: { blocks: { exercises: { sets: { completedAt: string | null }[] }[] }[] }): number {
  let n = 0;
  for (const b of log.blocks) for (const e of b.exercises) for (const s of e.sets) if (s.completedAt !== null) n++;
  return n;
}
