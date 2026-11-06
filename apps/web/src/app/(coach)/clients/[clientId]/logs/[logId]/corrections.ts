import { parseClock, type WorkoutLogDoc } from '@caltracker/shared';
import type { SetCorrection } from './actions';
import type { Drafts } from './planned-vs-actual';

const LABELS = { reps: 'Reps', weight: 'Weight', time: 'Time', distance: 'Distance' } as const;

/** A typed number, or null for blank, or NaN for text that isn't one. */
const num = (text: string): number | null => (text.trim() === '' ? null : /^\d*\.?\d+$/.test(text.trim()) ? Number(text) : NaN);

/**
 * The sets the coach changed: each draft compared with `before`, the boxes' text when Correct was clicked (not the
 * log as it is now, which a live update may have replaced since). Returns an error message for a blank or
 * unreadable box, or 'Nothing to change.' when nothing differs.
 */
export function buildCorrections(drafts: Drafts, before: Drafts): { sets: SetCorrection[] } | { error: string } {
  const sets: SetCorrection[] = [];
  for (const [id, draft] of Object.entries(drafts)) {
    const set: SetCorrection = { id };
    let changed = false;
    for (const key of ['reps', 'weight', 'time', 'distance'] as const) {
      const text = draft[key];
      if (text === undefined || text.trim() === (before[id]?.[key] ?? '').trim()) continue;
      const value = key === 'time' ? parseClock(text) : num(text);
      if (value === null) return { error: `${LABELS[key]} can't be blank.` };
      if (Number.isNaN(value)) return { error: 'Check the numbers you typed. Time looks like 1:30.' };
      changed = true;
      if (key === 'reps') set.actualReps = value;
      else if (key === 'weight') set.actualWeight = value;
      else if (key === 'time') set.actualDurationS = value;
      else set.actualDistance = value;
    }
    if (changed) sets.push(set);
  }
  return sets.length === 0 ? { error: 'Nothing to change.' } : { sets };
}

/** Changes whenever the phone saves the log again (revision) or its last activity moves (e.g. auto-finish). */
export const logVersion = (log: Pick<WorkoutLogDoc, 'revision' | 'lastActivityAt'>): string => `${log.revision}|${log.lastActivityAt}`;

export const CLIENT_UPDATED_MESSAGE = 'The client updated this workout. Review the latest numbers before saving.';
