import { describe, expect, it } from 'vitest';
import { FEELINGS, LOG_NOTES_MAX, composeFinishNotes, readFinishNotes } from '../../src/logs/finish-note';
import { setLogNotes } from '../../src/logs/ops';
import { WorkoutLogDoc } from '../../src/logs/schema';
import { startLogFromWorkout } from '../../src/logs/start';
import { fixtureWorkout, uuid } from './fixture';

const T0 = '2026-11-05T10:00:00.000Z';
const T1 = '2026-11-05T10:05:00.000Z';

describe('finish notes', () => {
  it('lists the five feelings in order', () => {
    expect(FEELINGS).toEqual(['Easy', 'OK', 'Good', 'Hard', 'Max']);
  });

  it('puts the feeling on its own first line, then the note', () => {
    expect(composeFinishNotes('Good', 'Lat pulldown was taken.')).toBe('Felt: Good\nLat pulldown was taken.');
    expect(composeFinishNotes('Hard', '')).toBe('Felt: Hard');
    expect(composeFinishNotes(null, '  Knee ok  ')).toBe('Knee ok');
    expect(composeFinishNotes(null, '   ')).toBeNull();
  });

  it('never goes past the log notes limit', () => {
    const out = composeFinishNotes('Max', 'x'.repeat(3000));
    expect(out!.length).toBe(LOG_NOTES_MAX);
    expect(out!.startsWith('Felt: Max\n')).toBe(true);
  });

  it('reads back what it wrote', () => {
    expect(readFinishNotes('Felt: Good\nLat pulldown was taken.')).toEqual({ feel: 'Good', note: 'Lat pulldown was taken.' });
    expect(readFinishNotes('Felt: Easy')).toEqual({ feel: 'Easy', note: '' });
    expect(readFinishNotes('Just a note')).toEqual({ feel: null, note: 'Just a note' });
    expect(readFinishNotes('Felt: Sleepy\nx')).toEqual({ feel: null, note: 'Felt: Sleepy\nx' });
    expect(readFinishNotes(null)).toEqual({ feel: null, note: '' });
  });
});

describe('setLogNotes', () => {
  const fresh = () => startLogFromWorkout(fixtureWorkout(), uuid, T0);

  it('sets and clears the workout note, bumping the revision', () => {
    const log = fresh();
    const out = setLogNotes(log, 'Felt: Good', T1);
    expect(out.notes).toBe('Felt: Good');
    expect(out.revision).toBe(log.revision + 1);
    expect(out.lastActivityAt).toBe(T1);
    expect(setLogNotes(out, null, T1).notes).toBeNull();
  });

  it('returns the same doc when nothing changes, and keeps the doc valid when too long', () => {
    const log = fresh();
    expect(setLogNotes(log, null, T1)).toBe(log);
    const long = setLogNotes(log, 'y'.repeat(5000), T1);
    expect(long.notes!.length).toBe(LOG_NOTES_MAX);
    expect(WorkoutLogDoc.safeParse(long).success).toBe(true);
  });

  it('refuses a log that is no longer in progress', () => {
    const log = { ...fresh(), status: 'discarded' as const };
    expect(setLogNotes(log, 'x', T1)).toBe(log);
  });
});
