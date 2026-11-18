import { describe, expect, it } from 'vitest';
import { addStraightBlock, emptyWorkout, startLogFromWorkout, updateActual, type WorkoutLogDoc } from '@caltracker/shared';
import { draftToRestore, encodeDraft, isDraftSaved } from './session-draft';

let n = 0;
const makeId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const T = '2026-11-10T10:00:00.000Z';

function started(): WorkoutLogDoc {
  const w = addStraightBlock(emptyWorkout(makeId, 'Legs'), { id: makeId(), name: 'Squat', trackingType: 'weight_reps' }, makeId);
  return { ...startLogFromWorkout(w, makeId, T), revision: 1 };
}

/** The coach types 47 kg on the first set: one revision on from `log`. */
function typed(log: WorkoutLogDoc): WorkoutLogDoc {
  const set = log.blocks[0]!.exercises[0]!.sets[0]!;
  return updateActual(log, set.id, { actualWeightKg: 47 });
}

describe('session drafts kept on this device', () => {
  it('brings back edits the server never got (the save was lost when the coach left the page)', () => {
    const server = started();
    const draft = typed(server);
    expect(draft.revision).toBeGreaterThan(server.revision);
    expect(draftToRestore(encodeDraft(draft, server.revision), server)).toEqual(draft);
  });

  it('also when some of the edits were saved before the page closed', () => {
    const base = started();
    const partly = typed(base);
    const more = { ...typed(partly), revision: partly.revision + 1 };
    expect(draftToRestore(encodeDraft(more, base.revision), partly)).toEqual(more);
  });

  it('ignores a draft the server already has', () => {
    const server = typed(started());
    expect(draftToRestore(encodeDraft(server, 1), server)).toBeNull();
  });

  it('ignores a draft for another session', () => {
    const server = started();
    const other = typed(started());
    expect(draftToRestore(encodeDraft(other, 1), server)).toBeNull();
  });

  it('ignores a draft once the session is finished or discarded somewhere else', () => {
    const base = started();
    const draft = typed(base);
    expect(draftToRestore(encodeDraft(draft, base.revision), { ...base, status: 'discarded' })).toBeNull();
    expect(draftToRestore(encodeDraft(draft, base.revision), { ...base, status: 'completed' })).toBeNull();
  });

  it('ignores a draft built on an older copy than the one it was based on (changed elsewhere since)', () => {
    const base = { ...started(), revision: 5 };
    const draft = { ...typed(base), revision: 9 };
    // The server is at 3: not a copy this draft grew from.
    expect(draftToRestore(encodeDraft(draft, 5), { ...base, revision: 3 })).toBeNull();
  });

  it('ignores missing or broken drafts', () => {
    const server = started();
    expect(draftToRestore(null, server)).toBeNull();
    expect(draftToRestore('not json', server)).toBeNull();
    expect(draftToRestore(JSON.stringify({ base: 1, doc: { id: server.id } }), server)).toBeNull();
  });

  it('knows when a draft has been saved', () => {
    const draft = typed(started());
    const raw = encodeDraft(draft, 1);
    expect(isDraftSaved(raw, draft.revision - 1)).toBe(false);
    expect(isDraftSaved(raw, draft.revision)).toBe(true);
    expect(isDraftSaved(null, 0)).toBe(true);
  });
});
