import type { HomeLog, HomeWorkout } from '../../src/coach-home/home';

let n = 0;
export const doneLog: HomeLog = {
  id: 'l',
  status: 'completed',
  startedAt: '2026-11-01T10:00:00Z',
  finishedAt: '2026-11-01T10:30:00Z',
  lastActivityAt: '2026-11-01T10:30:00Z',
};

/** A planned workout on `scheduledOn`, done or not. */
export function planned(scheduledOn: string, isDone = false): HomeWorkout {
  n += 1;
  return { id: `w${n}`, clientId: 'c', name: 'Upper', scheduledOn, logs: isDone ? [doneLog] : [] };
}
