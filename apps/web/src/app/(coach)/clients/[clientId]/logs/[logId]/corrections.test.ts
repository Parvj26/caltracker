import { describe, expect, it } from 'vitest';
import { buildCorrections, logVersion } from './corrections';

describe('buildCorrections', () => {
  it('sends only the boxes that differ from the starting values', () => {
    const before = { a: { reps: '8', weight: '60' }, b: { reps: '8', weight: '60' } };
    const drafts = { a: { reps: '9', weight: '60' }, b: { reps: '8', weight: '60' } };
    expect(buildCorrections(drafts, before)).toEqual({ sets: [{ id: 'a', actualReps: 9 }] });
  });

  it('compares with the values when Correct was clicked, not newer ones from the phone', () => {
    // The coach opened Correct at 8 reps and left the box alone; the phone has since synced 10.
    // Comparing with the starting 8 sends nothing, so the phone's 10 is not overwritten with the old 8.
    const atStart = { a: { reps: '8' } };
    const drafts = { a: { reps: '8' } };
    expect(buildCorrections(drafts, atStart)).toEqual({ error: 'Nothing to change.' });
    // Compared with the newer log (10), the untouched 8 would have looked like a change back to 8.
    expect(buildCorrections(drafts, { a: { reps: '10' } })).toEqual({ sets: [{ id: 'a', actualReps: 8 }] });
  });

  it('reads time and distance, and refuses blank or unreadable boxes', () => {
    expect(buildCorrections({ a: { time: '1:30' } }, { a: { time: '1:00' } })).toEqual({ sets: [{ id: 'a', actualDurationS: 90 }] });
    expect(buildCorrections({ a: { distance: '2.5' } }, { a: { distance: '2' } })).toEqual({ sets: [{ id: 'a', actualDistance: 2.5 }] });
    expect(buildCorrections({ a: { reps: ' ' } }, { a: { reps: '8' } })).toEqual({ error: "Reps can't be blank." });
    expect(buildCorrections({ a: { weight: 'abc' } }, { a: { weight: '60' } })).toEqual({ error: 'Check the numbers you typed. Time looks like 1:30.' });
  });
});

describe('logVersion', () => {
  it('changes with the revision or the last activity', () => {
    const v = logVersion({ revision: 3, lastActivityAt: '2026-11-06T10:00:00Z' });
    expect(logVersion({ revision: 4, lastActivityAt: '2026-11-06T10:00:00Z' })).not.toBe(v);
    expect(logVersion({ revision: 3, lastActivityAt: '2026-11-06T10:05:00Z' })).not.toBe(v);
    expect(logVersion({ revision: 3, lastActivityAt: '2026-11-06T10:00:00Z' })).toBe(v);
  });
});
