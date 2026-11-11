import { describe, expect, it } from 'vitest';
import { planAward } from '../../src/awards/award';
import { BONUS_PRIORITY, pickBonus } from '../../src/awards/bonus';
import type { Bonus, QueuedBonus } from '../../src/awards/bonus';
import { mkLog, stats } from './helpers';

const milestone = (value: number): Bonus => ({ kind: 'milestone', key: null, value });
const landmark = (key: string): Bonus => ({ kind: 'landmark', key, value: null });
const rare = (key: string): Bonus => ({ kind: 'rare', key, value: null });

let n = 0;
const queued = (b: Bonus, earnedAt: string, over: Partial<QueuedBonus> = {}): QueuedBonus => ({
  ...b,
  id: `q${++n}`,
  earnedLogId: `log-${n}`,
  earnedAt,
  seq: n,
  ...over,
});

const NOW = '2026-11-05T11:00:00.000Z';
const at = { logId: 'this-log', finishedAt: NOW, owned: new Set<string>() };

describe('pickBonus', () => {
  it('ranks milestone, then landmark, then rare find, then drop', () => {
    expect(BONUS_PRIORITY).toEqual(['milestone', 'landmark', 'rare', 'drop']);
  });

  it('gives nothing and queues nothing when nothing was earned or waiting', () => {
    expect(pickBonus({ ...at, earned: [], queue: [] })).toEqual({ give: null, fromQueue: null, enqueue: [], discard: [] });
  });

  it('gives the one bonus earned', () => {
    expect(pickBonus({ ...at, earned: [rare('axolotl')], queue: [] })).toMatchObject({ give: rare('axolotl'), enqueue: [] });
  });

  it('gives the highest-priority bonus earned and queues the rest in priority order', () => {
    const r = pickBonus({ ...at, earned: [rare('axolotl'), landmark('colosseum'), rare('quokka'), milestone(10)], queue: [] });
    expect(r.give).toEqual(milestone(10));
    expect(r.fromQueue).toBeNull();
    expect(r.enqueue).toEqual([landmark('colosseum'), rare('axolotl'), rare('quokka')]);
  });

  it('gives a waiting bonus first when nothing new outranks it, and queues the new one', () => {
    const q = queued(landmark('chichen-itza'), '2026-11-04T10:00:00.000Z');
    const r = pickBonus({ ...at, earned: [rare('axolotl')], queue: [q] });
    expect(r.give).toEqual(landmark('chichen-itza'));
    expect(r.fromQueue).toBe(q.id);
    expect(r.enqueue).toEqual([rare('axolotl')]);
  });

  it('a new bonus that outranks everything waiting is given at once; the queue keeps waiting', () => {
    const q = queued(rare('quokka'), '2026-11-04T10:00:00.000Z');
    const r = pickBonus({ ...at, earned: [milestone(10)], queue: [q] });
    expect(r.give).toEqual(milestone(10));
    expect(r.fromQueue).toBeNull();
    expect(r.enqueue).toEqual([]);
  });

  it('a tie in priority goes to the oldest: the waiting one before the new one, then by earning time, then order', () => {
    const late = queued(landmark('petra'), '2026-11-03T10:00:00.000Z', { seq: 1 });
    const early = queued(landmark('chichen-itza'), '2026-11-01T10:00:00.000Z', { seq: 2 });
    const sameTimeFirst = queued(landmark('christ-the-redeemer'), '2026-11-01T10:00:00.000Z', { seq: 0 });
    expect(pickBonus({ ...at, earned: [landmark('colosseum')], queue: [late, early] }).give).toEqual(landmark('chichen-itza'));
    expect(pickBonus({ ...at, earned: [], queue: [early, sameTimeFirst] }).fromQueue).toBe(sameTimeFirst.id);
    // Postgres timestamps (microseconds, +00) order as instants, not as text.
    const pg = queued(landmark('taj-mahal'), '2026-11-01 09:00:00.123456+00', { seq: 9 });
    expect(pickBonus({ ...at, earned: [], queue: [early, pg] }).fromQueue).toBe(pg.id);
  });

  it('gives at most one bonus however much is waiting', () => {
    const q = [queued(rare('quokka'), '2026-11-01T10:00:00.000Z'), queued(rare('axolotl'), '2026-11-02T10:00:00.000Z')];
    const r = pickBonus({ ...at, earned: [], queue: q });
    expect(r.give).toEqual(rare('quokka'));
    expect(r.enqueue).toEqual([]);
  });

  it('only hands a waiting bonus to a workout finished after the one that earned it', () => {
    const later = queued(landmark('petra'), '2026-11-06T10:00:00.000Z');
    const same = queued(landmark('petra'), NOW);
    const own = queued(landmark('petra'), '2026-11-01T10:00:00.000Z', { earnedLogId: 'this-log' });
    expect(pickBonus({ ...at, earned: [], queue: [later, same, own] })).toEqual({ give: null, fromQueue: null, enqueue: [], discard: [] });
  });

  it('never queues a rare find or drop twice, and drops a waiting one the client already owns', () => {
    const waiting = queued(rare('quokka'), '2026-11-01T10:00:00.000Z');
    const r = pickBonus({ ...at, earned: [milestone(50), rare('quokka')], queue: [waiting] });
    expect(r.give).toEqual(milestone(50));
    expect(r.enqueue).toEqual([]);

    const owned = queued(rare('axolotl'), '2026-11-01T10:00:00.000Z');
    const s = pickBonus({ ...at, owned: new Set(['axolotl']), earned: [], queue: [owned, waiting] });
    expect(s.discard).toEqual([owned.id]);
    expect(s.fromQueue).toBe(waiting.id);
  });

  it('queues a landmark earned again (a new streak reaching it again is a second sticker)', () => {
    const waiting = queued(landmark('chichen-itza'), '2026-11-01T10:00:00.000Z');
    const r = pickBonus({ ...at, earned: [milestone(10), landmark('chichen-itza')], queue: [waiting] });
    expect(r.enqueue).toEqual([landmark('chichen-itza')]);
  });
});

describe('planAward: at most one bonus sticker per workout', () => {
  const sets = (k: number, w = 60, r = 10) => Array.from({ length: k }, () => ({ w, r }));
  const base = (over: Partial<Parameters<typeof planAward>[0]> = {}): Parameters<typeof planAward>[0] => ({
    log: mkLog([{ sets: sets(5) }]),
    owned: new Map<string, { count: number; shiny: boolean }>(),
    prHistory: [],
    firstLogOfExercise: new Set<string>(),
    statsBefore: stats(),
    statsAfter: stats(),
    rng: () => 0.5,
    ladderHistory: [],
    keepLadder: 'rhino',
    ...over,
  });

  it('the workout that earns a milestone, a landmark and two rare finds gives the ladder animal and the milestone', () => {
    const p = planAward(base({ statsBefore: stats({ workouts: 9, streak: 3 }), statsAfter: stats({ workouts: 10, streak: 4 }) }));
    expect(p.award.ladder?.key).toBe('rhino');
    expect(p.award).toMatchObject({ milestone: 10, landmarks: [], rare: [], drop: null });
    expect(p.enqueue).toEqual([landmark('colosseum'), rare('axolotl'), rare('quokka')]);
    expect(p.fromQueue).toBeNull();
  });

  it('a later workout with nothing new gives the oldest highest-priority waiting bonus', () => {
    const q = [queued(rare('quokka'), '2026-11-01T10:00:00.000Z'), queued(landmark('colosseum'), '2026-11-02T10:00:00.000Z')];
    // The landmark outranks the waiting rare find; the newly met axolotl (10 workouts) joins the queue.
    const p = planAward(base({ statsBefore: stats({ workouts: 10 }), statsAfter: stats({ workouts: 11 }), bonusQueue: q }));
    expect(p.award).toMatchObject({ landmarks: ['colosseum'], rare: [], milestone: null, drop: null });
    expect(p.fromQueue).toBe(q[1]!.id);
    expect(p.enqueue).toEqual([rare('axolotl')]);
  });

  it('rolls a drop only when there is nothing else to give', () => {
    const lucky = () => 0.001;
    expect(planAward(base({ rng: lucky })).award.drop).toBe('pink-river-dolphin');
    let calls = 0;
    const p = planAward(base({ rng: () => (calls++, 0.001), statsBefore: stats({ workouts: 0 }), statsAfter: stats({ workouts: 1 }) }));
    expect(p.award).toMatchObject({ milestone: 1, drop: null });
    expect(calls).toBe(1); // the shiny roll only: no drop roll, so no drop is lost or queued
    const waiting = planAward(base({ rng: lucky, bonusQueue: [queued(rare('quokka'), '2026-11-01T10:00:00.000Z')] }));
    expect(waiting.award).toMatchObject({ rare: ['quokka'], drop: null });
  });

  it('a non-qualifying workout still hands out a waiting bonus, but never rolls', () => {
    const q = [queued(landmark('petra'), '2026-11-01T10:00:00.000Z')];
    let calls = 0;
    const p = planAward(base({ log: mkLog([{ sets: sets(2) }]), rng: () => (calls++, 0.001), bonusQueue: q }));
    expect(p.award.landmarks).toEqual(['petra']);
    expect(calls).toBe(0);
  });

  it('keeps the stored shape: same fields, arrays of at most one, nothing new required', () => {
    const p = planAward(base({ statsBefore: stats({ workouts: 9, streak: 3 }), statsAfter: stats({ workouts: 10, streak: 4 }) }));
    expect(Object.keys(p.award).sort()).toEqual(['drop', 'ladder', 'landmarks', 'milestone', 'prs', 'rare', 'volumeKg']);
  });
});
