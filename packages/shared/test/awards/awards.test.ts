import { describe, expect, it } from 'vitest';
import { computeAward, revealCards } from '../../src/awards/award';
import { LANDMARK_JOURNEY, STICKERS } from '../../src/awards/catalogue';
import { formatMultiple, isQualifying, pickLadderAnimal } from '../../src/awards/ladder';
import { detectPrs, epley1rm } from '../../src/awards/prs';
import type { PersonalRecord } from '../../src/awards/prs';
import { milestoneFor, newRareFinds } from '../../src/awards/rare';
import { journeyStep, liveStreak, streakWeek, streakWeeks, weekKey } from '../../src/awards/streak';
import { EX_A, EX_B, mkLog, stats } from './helpers';

describe('STICKERS', () => {
  // Task 2 adds a check against the real art/stickers/*.png directory; until then the list is hard-coded.
  const ART = `axolotl big-ben bison blue-whale burj-khalifa capybara cat chichen-itza christ-the-redeemer colosseum corgi cow eiffel-tower elephant emperor-penguin empire-state fennec-fox giant-panda giraffe goat golden-gate golden-retriever golden-snub-nosed-monkey gorilla great-pyramid great-wall hippo horse humpback-whale kakapo kangaroo koala lion machu-picchu marathon moose mount-everest mount-fuji narwhal okapi orca pangolin petra pig pink-fairy-armadillo pink-river-dolphin polar-bear quokka rabbit red-panda rhino sheep snow-leopard snowy-owl statue-of-liberty taj-mahal walrus whale-shark white-peacock white-tiger`.split(' ');

  it('has 60 keys matching the art file names', () => {
    expect(STICKERS).toHaveLength(60);
    expect(STICKERS.map((s) => s.key).sort()).toEqual([...ART].sort());
  });
  it('has the right count per kind and short facts', () => {
    const n = (k: string) => STICKERS.filter((s) => s.kind === k).length;
    expect([n('ladder'), n('rare'), n('drop'), n('landmark')]).toEqual([30, 10, 3, 17]);
    for (const s of STICKERS) {
      expect(s.fact.length).toBeGreaterThan(0);
      expect(s.fact.length).toBeLessThanOrEqual(140);
    }
  });
  it('journey keys are all landmarks', () => {
    const landmarks = new Set(STICKERS.filter((s) => s.kind === 'landmark').map((s) => s.key));
    expect(LANDMARK_JOURNEY.map((j) => j.key).sort()).toEqual([...landmarks].sort());
  });
});

describe('ladder', () => {
  it('keeps a stored animal at or under the volume, with its multiple (more in ladder-pick.test.ts)', () => {
    expect(pickLadderAnimal(1470, [], 'x', 'giraffe')?.sticker.name).toBe('Giraffe');
    expect(pickLadderAnimal(1470, [], 'x', 'giraffe')?.multiple).toBeCloseTo(1.225);
    expect(pickLadderAnimal(1.9, [], 'x')).toBeNull();
    expect(pickLadderAnimal(150000, [], 'x', 'blue-whale')?.sticker.name).toBe('Blue whale');
  });
  it('formats the multiple', () => {
    expect(formatMultiple(1.225, 'Giraffe')).toBe('≈ 1.2 Giraffes');
    expect(formatMultiple(1.02, 'Giraffe')).toBe('≈ 1 Giraffe');
    expect(formatMultiple(12.4, 'Giraffe')).toBe('≈ 12 Giraffes');
    expect(formatMultiple(2.5, 'Walrus')).toBe('≈ 2.5 Walruses');
  });
  it('keeps Sheep, Moose and Bison unchanged and rounds 9.96 up to 10', () => {
    expect(formatMultiple(2.5, 'Sheep')).toBe('≈ 2.5 Sheep');
    expect(formatMultiple(2.5, 'Moose')).toBe('≈ 2.5 Moose');
    expect(formatMultiple(2.5, 'Bison')).toBe('≈ 2.5 Bison');
    expect(formatMultiple(9.96, 'Giraffe')).toBe('≈ 10 Giraffes');
  });
  it('qualifies at 5 completed sets', () => {
    const sets = (n: number) => Array.from({ length: n }, () => ({ w: 50, r: 5 }));
    expect(isQualifying(mkLog([{ sets: sets(4) }]))).toBe(false);
    expect(isQualifying(mkLog([{ sets: sets(5) }]))).toBe(true);
    expect(isQualifying(mkLog([{ sets: [...sets(4), { w: 50, r: 5, done: false }] }]))).toBe(false);
  });
});

describe('prs', () => {
  const rec = (kind: PersonalRecord['kind'], valueKg: number, reps: number | null): PersonalRecord => ({
    exerciseId: EX_A,
    kind,
    valueKg,
    reps,
    logId: 'old',
    achievedAt: '2026-10-01T00:00:00.000Z',
  });
  const history = [rec('heaviest', 100, 5), rec('e1rm', 116.7, 5), rec('reps_at_weight', 100, 5)];

  it('epley', () => {
    expect(epley1rm(100, 5)).toBe(116.7);
    expect(epley1rm(105, 3)).toBe(115.5);
  });
  it('first log is a baseline', () => {
    expect(detectPrs(mkLog([{ sets: [{ w: 100, r: 5 }] }]), [], new Set([EX_A]))).toEqual([]);
  });
  it('ignores warm-ups', () => {
    expect(detectPrs(mkLog([{ sets: [{ w: 200, r: 10, type: 'warmup' }] }]), history, new Set())).toEqual([]);
  });
  it('more reps at the same weight', () => {
    const prs = detectPrs(mkLog([{ sets: [{ w: 100, r: 6 }] }]), history, new Set());
    expect(prs.map((p) => p.kind).sort()).toEqual(['e1rm', 'reps_at_weight']);
    expect(prs.find((p) => p.kind === 'reps_at_weight')).toMatchObject({ valueKg: 100, reps: 6 });
  });
  it('heavier weight is heaviest but not e1rm', () => {
    const prs = detectPrs(mkLog([{ sets: [{ w: 105, r: 3 }] }]), history, new Set());
    expect(prs.map((p) => p.kind)).toEqual(['heaviest']);
  });
  it('skips cardio and unchanged lifts', () => {
    expect(detectPrs(mkLog([{ sets: [{ w: 100, r: 5 }] }]), history, new Set())).toEqual([]);
    expect(detectPrs(mkLog([{ trackingType: 'distance', sets: [{ w: 100, r: 9 }] }]), history, new Set())).toEqual([]);
  });
  it('a tie is not a PR', () => {
    expect(detectPrs(mkLog([{ sets: [{ w: 100, r: 5 }, { w: 100, r: 5 }] }]), history, new Set())).toEqual([]);
  });
  it('several sets of one exercise give one record per kind, from the best set', () => {
    const prs = detectPrs(mkLog([{ sets: [{ w: 100, r: 6 }, { w: 100, r: 7 }, { w: 110, r: 5 }] }]), history, new Set());
    expect(prs.filter((p) => p.kind === 'heaviest')).toHaveLength(1);
    expect(prs.find((p) => p.kind === 'heaviest')).toMatchObject({ valueKg: 110, reps: 5 });
    expect(prs.find((p) => p.kind === 'e1rm')).toMatchObject({ valueKg: epley1rm(110, 5), reps: 5 });
    expect(prs.filter((p) => p.kind === 'reps_at_weight')).toHaveLength(1);
    expect(prs.find((p) => p.kind === 'reps_at_weight')).toMatchObject({ valueKg: 100, reps: 7 });
  });
  it('judges each exercise on its own history', () => {
    expect(detectPrs(mkLog([{ exerciseId: EX_B, sets: [{ w: 300, r: 5 }] }]), history, new Set())).toEqual([]);
  });
});

describe('weekKey', () => {
  it('uses the client time zone', () => {
    expect(weekKey('2026-11-09T07:30:00Z', 'America/Los_Angeles')).toBe('2026-11-02');
    expect(weekKey('2026-11-09T07:30:00Z', 'UTC')).toBe('2026-11-09');
  });
  it('handles the DST change of 2026-11-01', () => {
    expect(weekKey('2026-11-01T08:30:00Z', 'America/Los_Angeles')).toBe('2026-10-26');
    expect(weekKey('2026-11-02T07:59:00Z', 'America/Los_Angeles')).toBe('2026-10-26');
    expect(weekKey('2026-11-02T08:00:00Z', 'America/Los_Angeles')).toBe('2026-11-02');
  });
});

describe('streakWeeks', () => {
  it('counts consecutive weeks', () => {
    expect(streakWeeks(['2026-10-19', '2026-10-26', '2026-11-02'], '2026-11-02')).toEqual({ current: 3, best: 3 });
  });
  it('a gap resets current and keeps best', () => {
    const w = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-26', '2026-11-02'];
    expect(streakWeeks(w, '2026-11-02')).toEqual({ current: 2, best: 4 });
  });
  it('ignores duplicate week keys', () => {
    expect(streakWeeks(['2026-10-26', '2026-10-26', '2026-11-02', '2026-11-02'], '2026-11-02')).toEqual({ current: 2, best: 2 });
  });
  it('an empty current week does not break the streak yet', () => {
    expect(streakWeeks(['2026-10-19', '2026-10-26'], '2026-11-02')).toEqual({ current: 2, best: 2 });
    expect(streakWeeks(['2026-10-19', '2026-10-26'], '2026-11-09')).toEqual({ current: 0, best: 2 });
    expect(streakWeeks([], '2026-11-02')).toEqual({ current: 0, best: 0 });
  });
});

describe('streakWeek', () => {
  it('is the current week when it has a workout', () => {
    expect(streakWeek(['2026-10-26', '2026-11-02'], '2026-11-02')).toBe('2026-11-02');
  });
  it('is last week when this week has none yet', () => {
    expect(streakWeek(['2026-10-19', '2026-10-26'], '2026-11-02')).toBe('2026-10-26');
  });
  it('is null when the streak is already broken or there is none', () => {
    expect(streakWeek(['2026-10-19'], '2026-11-02')).toBeNull();
    expect(streakWeek([], '2026-11-02')).toBeNull();
  });
  it('ignores weeks after the current one', () => {
    expect(streakWeek(['2026-11-09'], '2026-11-02')).toBeNull();
  });
});

describe('liveStreak', () => {
  it('keeps the stored streak while its last week is this week', () => {
    expect(liveStreak(3, '2026-11-02', '2026-11-02')).toBe(3);
  });
  it('keeps it while this week has no workout yet (the week is not over)', () => {
    expect(liveStreak(3, '2026-10-26', '2026-11-02')).toBe(3);
  });
  it('drops to 0 once a whole week ended without a workout', () => {
    expect(liveStreak(3, '2026-10-19', '2026-11-02')).toBe(0);
    expect(liveStreak(12, '2026-01-05', '2026-11-02')).toBe(0);
  });
  it('is 0 with no last week or no streak', () => {
    expect(liveStreak(3, null, '2026-11-02')).toBe(0);
    expect(liveStreak(0, '2026-11-02', '2026-11-02')).toBe(0);
  });
  it('trusts a last week ahead of the viewer (their zone is a day behind the client)', () => {
    expect(liveStreak(2, '2026-11-09', '2026-11-02')).toBe(2);
  });
  it('works across a year boundary', () => {
    expect(liveStreak(5, '2026-12-28', '2027-01-04')).toBe(5);
    expect(liveStreak(5, '2026-12-21', '2027-01-04')).toBe(0);
  });
});

describe('journeyStep', () => {
  it('steps through the journey', () => {
    expect(journeyStep(4)).toEqual({ reached: ['colosseum'], next: { week: 6, key: 'taj-mahal' } });
    expect(journeyStep(5).reached).toEqual([]);
    expect(journeyStep(52)).toEqual({ reached: ['great-wall'], next: null });
    expect(journeyStep(0).next).toEqual({ week: 1, key: 'chichen-itza' });
  });
});

describe('rare finds and milestones', () => {
  const keys = (s: ReturnType<typeof newRareFinds>) => s.map((x) => x.key);
  it('grants each at its threshold', () => {
    expect(keys(newRareFinds(stats(), stats({ workouts: 10 }), new Set()))).toEqual(['axolotl']);
    expect(keys(newRareFinds(stats(), stats({ streak: 4, bestStreak: 4 }), new Set()))).toEqual(['quokka']);
    expect(keys(newRareFinds(stats(), stats({ lifetimeVolumeKg: 1_000_000 }), new Set()))).toEqual(['pink-fairy-armadillo', 'narwhal']);
    expect(keys(newRareFinds(stats(), stats({ workouts: 9 }), new Set()))).toEqual([]);
  });
  it('skips owned', () => {
    expect(newRareFinds(stats(), stats({ workouts: 10 }), new Set(['axolotl']))).toEqual([]);
  });
  it('milestones', () => {
    expect([1, 10, 50, 100].map(milestoneFor)).toEqual([1, 10, 50, 100]);
    expect(milestoneFor(2)).toBeNull();
  });
});

describe('computeAward', () => {
  const sets = (n: number, w = 100, r = 10) => Array.from({ length: n }, () => ({ w, r })); // 1000 kg each set
  const base = (over: Partial<Parameters<typeof computeAward>[0]> = {}) => ({
    log: mkLog([{ sets: sets(5, 60, 10) }]), // 3000 kg; the stored rhino (2,300 kg) fits, so it is kept
    owned: new Map<string, { count: number; shiny: boolean }>(),
    prHistory: [],
    firstLogOfExercise: new Set<string>(),
    statsBefore: stats(),
    statsAfter: stats(),
    rng: () => 0.5,
    ladderHistory: [] as string[],
    keepLadder: 'rhino' as string | null,
    ...over,
  });

  it('awards the ladder animal, new, no shiny at 0.5', () => {
    const a = computeAward(base());
    expect(a.ladder).toMatchObject({ key: 'rhino', isNew: true, count: 1, shiny: false });
    expect(a.drop).toBeNull();
  });
  it('rng 0.01 gives shiny and a drop; 0.99 neither', () => {
    const lucky = computeAward(base({ rng: () => 0.01 }));
    expect(lucky.ladder?.shiny).toBe(true);
    expect(lucky.drop).toBe('pink-river-dolphin');
    const unlucky = computeAward(base({ rng: () => 0.99 }));
    expect(unlucky.ladder?.shiny).toBe(false);
    expect(unlucky.drop).toBeNull();
  });
  it('repeats raise the count; shiny never rolls twice', () => {
    const owned = new Map([['rhino', { count: 3, shiny: true }]]);
    const a = computeAward(base({ owned, rng: () => 0.99 }));
    expect(a.ladder).toMatchObject({ isNew: false, count: 4, shiny: true });
    let calls = 0;
    computeAward(base({ owned, rng: () => (calls++, 0.99) }));
    expect(calls).toBe(1); // only the drop roll
  });
  it('with nothing stored, picks by the rule from the history and the log id, without using the rolls', () => {
    const log = mkLog([{ sets: sets(1, 10, 1) }]); // 10 kg: rabbit, cat, red panda, koala
    let calls = 0;
    const a = computeAward(base({ log, keepLadder: null, ladderHistory: ['rabbit', 'cat', 'koala'], rng: () => (calls++, 0.5) }));
    expect(a.ladder).toMatchObject({ key: 'red-panda', multiple: 2, isNew: true, count: 1 });
    expect(calls).toBe(0); // under 5 sets: no rolls, and the pick has its own seeded source
  });
  it('a stored animal stays after a correction below it, with a multiple under 1', () => {
    const a = computeAward(base({ log: mkLog([{ sets: sets(5, 20, 10) }]) })); // 1,000 kg, stored rhino 2,300 kg
    expect(a.ladder).toMatchObject({ key: 'rhino', multiple: 1000 / 2300 });
  });
  it('drops only from those not owned', () => {
    const owned = new Map([['pink-river-dolphin', { count: 1, shiny: false }]]);
    expect(computeAward(base({ owned, rng: () => 0.01 })).drop).toBe('kakapo');
  });
  it('a non-qualifying workout never rolls', () => {
    const a = computeAward(base({ log: mkLog([{ sets: sets(4, 60, 10) }]), rng: () => 0.01 }));
    expect(a.ladder?.shiny).toBe(false);
    expect(a.drop).toBeNull();
  });
  it('stores the workout volume with the award, for shared cards', () => {
    expect(computeAward(base({ log: mkLog([{ sets: sets(5, 20, 10) }]) })).volumeKg).toBe(1000);
    expect(computeAward(base({ log: mkLog([{ sets: sets(3, 0.1, 1) }]) })).volumeKg).toBe(0.3);
    expect(computeAward(base({ log: mkLog([{ trackingType: 'distance', sets: sets(6) }]), keepLadder: null })).volumeKg).toBe(0);
  });
  it('a cardio-only log has no ladder', () => {
    const a = computeAward(base({ log: mkLog([{ trackingType: 'distance', sets: sets(6) }]), keepLadder: null }));
    expect(a.ladder).toBeNull();
  });
  it('landmarks only when the streak moves up; milestones only when the count moves', () => {
    const up = computeAward(base({ statsBefore: stats({ workouts: 9, streak: 3 }), statsAfter: stats({ workouts: 10, streak: 4 }) }));
    // One bonus per workout: the milestone; the landmark and rare finds wait (bonus.test.ts).
    expect(up.milestone).toBe(10);
    expect(up.landmarks).toEqual([]);
    expect(up.rare).toEqual([]);
    expect(computeAward(base({ statsBefore: stats({ streak: 3 }), statsAfter: stats({ streak: 4 }) })).landmarks).toEqual(['colosseum']);
    const same = computeAward(base({ statsBefore: stats({ workouts: 10, streak: 4 }), statsAfter: stats({ workouts: 11, streak: 4 }) }));
    expect(same.landmarks).toEqual([]);
    expect(same.milestone).toBeNull();
  });
  it('a streak restarting at 1 earns the first landmark again', () => {
    const a = computeAward(base({ statsBefore: stats({ streak: 0, bestStreak: 6 }), statsAfter: stats({ streak: 1, bestStreak: 6 }) }));
    expect(a.landmarks).toEqual(['chichen-itza']);
  });
  it('reveal order: ladder, drop, rare, landmark, milestone', () => {
    const cards = revealCards({
      ladder: { key: 'rhino', multiple: 1.3, isNew: true, count: 1, shiny: false },
      drop: 'kakapo',
      rare: ['axolotl'],
      landmarks: ['colosseum'],
      milestone: 10,
      prs: [],
    });
    expect(cards).toEqual([
      { type: 'ladder', key: 'rhino', value: 1.3 },
      { type: 'drop', key: 'kakapo' },
      { type: 'rare', key: 'axolotl' },
      { type: 'landmark', key: 'colosseum' },
      { type: 'milestone', value: 10 },
    ]);
    expect(revealCards({ ladder: null, drop: null, rare: [], landmarks: [], milestone: null, prs: [] })).toEqual([]);
  });
});
