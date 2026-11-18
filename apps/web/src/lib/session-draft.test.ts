import { describe, expect, it } from 'vitest';
import { addLogSet, addStraightBlock, completeSet, emptyWorkout, startLogFromWorkout, updateActual, type WorkoutLogDoc } from '@caltracker/shared';
import { DRAFT_MAX_AGE_MS, decodeDraft, draftKey, encodeDraft, mergeDrafts, staleDraftKeys, usableDrafts, type Draft } from './session-draft';

let n = 0;
const makeId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const T = '2026-11-10T10:00:00.000Z';
const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const COACH = 'coach-1';

function started(revision = 1): WorkoutLogDoc {
  const w = addStraightBlock(emptyWorkout(makeId, 'Legs'), { id: makeId(), name: 'Squat', trackingType: 'weight_reps' }, makeId);
  return { ...startLogFromWorkout(w, makeId, T), revision };
}
const sets = (l: WorkoutLogDoc) => l.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets));
const weigh = (l: WorkoutLogDoc, i: number, kg: number) => updateActual(l, sets(l)[i]!.id, { actualWeightKg: kg });
const draft = (base: WorkoutLogDoc, doc: WorkoutLogDoc, over: Partial<Draft> = {}): Draft => ({ userId: COACH, tabId: 'tab-a', savedAt: NOW - 1000, base, doc, ...over });
const stored = (d: Draft) => ({ key: draftKey(d.doc.id, d.tabId), raw: encodeDraft(d) });

describe('mergeDrafts', () => {
  it('takes a kept copy whole when the server is still at the copy it grew from', () => {
    const server = started(5);
    const kept = weigh(server, 0, 47);
    const m = mergeDrafts(server, [draft(server, kept)]);
    expect(m.doc).toEqual(kept);
    expect(m.restored).toBe(true);
    // The kept change is also queued, so a refused (stale) save redoes it on the newer copy.
    expect(m.unsaved).toHaveLength(1);
    expect(m.unsaved[0]!.revision).toBe(kept.revision);
  });

  it('keeps a whole copy\'s added set too, when nothing changed on the server', () => {
    const server = started(5);
    const kept = addLogSet(server, server.blocks[0]!.exercises[0]!.id, makeId, T);
    const m = mergeDrafts(server, [draft(server, kept)]);
    expect(sets(m.doc)).toHaveLength(sets(kept).length);
    expect(m.partial).toBe(false);
    expect(m.shapeChanged).toBe(true);
  });

  it('two tabs: A lost its save (base 5, at 9); B saved the server on to 8. A\'s weight and B\'s sets both stay', () => {
    const base = started(5);
    const a = { ...weigh(base, 0, 47), revision: 9 };
    const server = { ...updateActual(completeSet(base, sets(base)[1]!.id, T), sets(base)[1]!.id, { actualReps: 12 }), revision: 8 };
    const m = mergeDrafts(server, [draft(base, a)]);
    expect(sets(m.doc)[0]!.actualWeightKg).toBe(47);
    expect(sets(m.doc)[1]).toMatchObject({ actualReps: 12 });
    expect(sets(m.doc)[1]!.completedAt).not.toBeNull();
    expect(m.doc.revision).toBe(9);
    expect(m.unsaved).toHaveLength(1);
  });

  it('a weight changed in another tab since stays, and says so (A 100 over base 80, B saved 110)', () => {
    const base = { ...weigh(started(5), 0, 80), revision: 5 };
    const a = weigh(base, 0, 100);
    const server = { ...weigh(base, 0, 110), revision: 7 };
    const m = mergeDrafts(server, [draft(base, a)]);
    expect(sets(m.doc)[0]!.actualWeightKg).toBe(110);
    expect(m.partial).toBe(true);
  });

  it('remembers when a copy taken whole changed the sets, for a refused save later', () => {
    const server = started(5);
    const kept = addLogSet(server, server.blocks[0]!.exercises[0]!.id, makeId, T);
    expect(mergeDrafts(server, [draft(server, kept)]).shapeChanged).toBe(true);
    expect(mergeDrafts(server, [draft(server, weigh(server, 0, 40))]).shapeChanged).toBe(false);
  });

  it('says so when a change could not be redone on a server copy that moved on', () => {
    const base = started(5);
    const kept = weigh(addLogSet(base, base.blocks[0]!.exercises[0]!.id, makeId, T), 0, 50);
    const server = { ...weigh(base, 1, 30), revision: 6 };
    const m = mergeDrafts(server, [draft(base, kept)]);
    expect(m.partial).toBe(true);
    expect(sets(m.doc)[0]!.actualWeightKg).toBe(50);
    expect(sets(m.doc)).toHaveLength(sets(base).length);
  });

  it('puts edits made on this page since it opened on top', () => {
    const base = started(5);
    const kept = weigh(base, 0, 47);
    const m = mergeDrafts(base, [draft(base, kept)], [(l) => weigh(l, 1, 60)]);
    expect(sets(m.doc).slice(0, 2).map((s) => s.actualWeightKg)).toEqual([47, 60]);
    expect(m.unsaved).toHaveLength(2);
  });

  it('merges nothing once the session ended, or from a copy newer than the server, or with no changes', () => {
    const base = started(5);
    const kept = weigh(base, 0, 47);
    expect(mergeDrafts({ ...base, status: 'discarded' }, [draft(base, kept)]).restored).toBe(false);
    expect(mergeDrafts({ ...base, revision: 3 }, [draft(base, kept)]).restored).toBe(false);
    expect(mergeDrafts(base, [draft(base, base)]).restored).toBe(false);
    expect(mergeDrafts(base, [draft(base, kept)], []).doc).not.toBe(base);
  });
});

describe('which kept copies count', () => {
  const base = started(5);
  const kept = weigh(base, 0, 47);

  it('only this coach\'s, for this session, and no older than two days', () => {
    const mine = draft(base, kept);
    const other = draft(base, kept, { userId: 'coach-2', tabId: 'tab-b' });
    const old = draft(base, kept, { tabId: 'tab-c', savedAt: NOW - DRAFT_MAX_AGE_MS - 1 });
    const elsewhere = draft(started(5), started(6), { tabId: 'tab-d' });
    const got = usableDrafts([stored(mine), stored(other), stored(old), stored(elsewhere)], { logId: base.id, userId: COACH, now: NOW });
    expect(got.map((d) => d.tabId)).toEqual(['tab-a']);
  });

  it('oldest first, from every tab', () => {
    const a = draft(base, kept, { tabId: 'a', savedAt: NOW - 10 });
    const b = draft(base, kept, { tabId: 'b', savedAt: NOW - 500 });
    expect(usableDrafts([stored(a), stored(b)], { logId: base.id, userId: COACH, now: NOW }).map((d) => d.tabId)).toEqual(['b', 'a']);
  });

  it('pruning on load drops broken, other coaches\' and old copies, and keeps the rest', () => {
    const mine = stored(draft(base, kept));
    const other = stored(draft(base, kept, { userId: 'coach-2', tabId: 'x' }));
    const old = stored(draft(base, kept, { tabId: 'y', savedAt: NOW - DRAFT_MAX_AGE_MS - 1 }));
    const broken = { key: draftKey(base.id, 'z'), raw: 'not json' };
    const unrelated = { key: 'something-else', raw: 'x' };
    expect(staleDraftKeys([mine, other, old, broken, unrelated], { userId: COACH, now: NOW }).sort()).toEqual([other.key, old.key, broken.key].sort());
  });

  it('reads back what it wrote; refuses the old format', () => {
    const d = draft(base, kept);
    expect(decodeDraft(encodeDraft(d))).toEqual(d);
    expect(decodeDraft(JSON.stringify({ base: 1, doc: kept }))).toBeNull();
    expect(decodeDraft(null)).toBeNull();
  });
});
