import { describe, expect, it } from 'vitest';
import {
  exerciseRegion,
  nextSuggestion,
  prefillLastTime,
  prescriptionOfLogExercise,
  prescriptionOfWorkoutExercise,
  progressionHint,
  progressionHistoryFromRows,
  suggestionForLogExercise,
  suggestionsForLog,
  suggestionsForWorkout,
  withSuggestion,
  type Prescription,
  type ProgressionSession,
} from '../../src/progression/progression';
import { resolveSetValues } from '../../src/logs/prefill';
import { toKg } from '../../src/units/units';
import type { LogExerciseDoc, LogSetDoc, WorkoutLogDoc } from '../../src/logs/schema';
import type { WorkoutDoc } from '../../src/workouts/schema';

const lb = (n: number) => toKg(n, 'lb');
const kg = (n: number) => n;

/** 3 × 8–10, no weight typed by the coach. */
const plan = (sets = 3, repsMin: number | null = 8, repsMax: number | null = 10, weightKg: number | null = null): Prescription => ({
  trackingType: 'weight_reps',
  sets: Array.from({ length: sets }, () => ({ setType: 'normal' as const, repsMin, repsMax, weightKg })),
});

/** One session: each [reps, weight in kg] is a done working set; null reps means not done. */
const session = (...sets: Array<[number | null, number]>): ProgressionSession => ({
  sets: sets.map(([reps, weightKg]) => ({ setType: 'normal', completed: reps !== null, reps, weightKg })),
});

describe('exerciseRegion', () => {
  it('is lower body for leg and hip muscles', () => {
    for (const m of ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors', 'lower back']) {
      expect(exerciseRegion([m])).toBe('lower');
    }
  });

  it('is upper body for everything else', () => {
    for (const m of ['chest', 'lats', 'shoulders', 'biceps', 'triceps', 'middle back', 'abdominals', 'traps']) {
      expect(exerciseRegion([m])).toBe('upper');
    }
  });

  it('defaults unknown or missing muscles to upper', () => {
    expect(exerciseRegion([])).toBe('upper');
    expect(exerciseRegion(['something new'])).toBe('upper');
  });

  it('counts an exercise as lower when any primary muscle is lower body, ignoring case', () => {
    expect(exerciseRegion(['Chest', 'Quadriceps'])).toBe('lower');
  });
});

describe('nextSuggestion: going up', () => {
  it('adds 5 lb to an upper-body exercise when every working set hit the top of the range', () => {
    const s = nextSuggestion([session([10, lb(135)], [10, lb(135)], [10, lb(135)])], plan(), 'upper', 'lb');
    expect(s).toEqual({ change: 'up', fromWeightKg: lb(135), weightKg: lb(140), delta: 5 });
  });

  it('adds 10 lb to a lower-body exercise', () => {
    const s = nextSuggestion([session([10, lb(225)], [10, lb(225)], [10, lb(225)])], plan(), 'lower', 'lb');
    expect(s?.weightKg).toBe(lb(235));
    expect(s?.delta).toBe(10);
  });

  it('adds 2.5 kg upper and 5 kg lower for kg users', () => {
    const done = [session([10, kg(60)], [10, kg(60)], [10, kg(60)])];
    expect(nextSuggestion(done, plan(), 'upper', 'kg')).toEqual({ change: 'up', fromWeightKg: 60, weightKg: 62.5, delta: 2.5 });
    expect(nextSuggestion(done, plan(), 'lower', 'kg')?.weightKg).toBe(65);
  });

  it('counts reps above the top as at the top', () => {
    expect(nextSuggestion([session([12, 60], [11, 60], [10, 60])], plan(), 'upper', 'kg')?.change).toBe('up');
  });

  it('holds when one working set fell short of the top', () => {
    expect(nextSuggestion([session([10, 60], [10, 60], [9, 60])], plan(), 'upper', 'kg')).toBeNull();
  });

  it('holds when a working set was left undone', () => {
    expect(nextSuggestion([session([10, 60], [10, 60], [null, 60])], plan(), 'upper', 'kg')).toBeNull();
  });

  it('ignores warm-ups and drops when judging the session', () => {
    const s: ProgressionSession = {
      sets: [
        { setType: 'warmup', completed: true, reps: 5, weightKg: 20 },
        { setType: 'normal', completed: true, reps: 10, weightKg: 60 },
        { setType: 'drop', completed: false, reps: null, weightKg: 40 },
        { setType: 'normal', completed: true, reps: 10, weightKg: 60 },
      ],
    };
    expect(nextSuggestion([s], plan(2), 'upper', 'kg')?.weightKg).toBe(62.5);
  });

  it('builds on the heaviest working weight of the last session', () => {
    expect(nextSuggestion([session([10, 55], [10, 60], [10, 60])], plan(), 'upper', 'kg')?.fromWeightKg).toBe(60);
  });

  it('judges each set against its own planned range (12, 10, 8 reps)', () => {
    const pyramid: Prescription = {
      trackingType: 'weight_reps',
      sets: [12, 10, 8].map((r) => ({ setType: 'normal' as const, repsMin: r, repsMax: r, weightKg: null })),
    };
    expect(nextSuggestion([session([12, 60], [10, 60], [8, 60])], pyramid, 'upper', 'kg')?.change).toBe('up');
    expect(nextSuggestion([session([12, 60], [9, 60], [8, 60])], pyramid, 'upper', 'kg')).toBeNull();
  });

  it('uses the last planned range for extra sets the client added', () => {
    expect(nextSuggestion([session([10, 60], [10, 60], [10, 60], [7, 60])], plan(), 'upper', 'kg')).toBeNull();
  });

  it('treats a single rep target as both top and bottom', () => {
    expect(nextSuggestion([session([5, 100], [5, 100])], plan(2, 5, null), 'lower', 'kg')?.weightKg).toBe(105);
    expect(nextSuggestion([session([5, 100], [5, 100])], plan(2, null, 5), 'lower', 'kg')?.weightKg).toBe(105);
  });

  it('only looks at the most recent session for going up', () => {
    const history = [session([9, 60], [9, 60]), session([10, 60], [10, 60])];
    expect(nextSuggestion(history, plan(2), 'upper', 'kg')).toBeNull();
  });
});

describe('nextSuggestion: plate steps', () => {
  it('keeps an exact kg weight someone typed on a half plate (61.25 kg → 63.75 kg)', () => {
    expect(nextSuggestion([session([10, 61.25], [10, 61.25])], plan(2), 'upper', 'kg')).toEqual({
      change: 'up',
      fromWeightKg: 61.25,
      weightKg: 63.75,
      delta: 2.5,
    });
  });

  it('snaps a weight logged in kg to the plate step for a client now in lb (45 kg = 99 lb → 100 + 5 lb)', () => {
    const s = nextSuggestion([session([10, 45], [10, 45])], plan(2), 'upper', 'lb');
    expect(s?.weightKg).toBe(lb(105));
    expect(s?.delta).toBe(5);
  });

  it('snaps a converted 60 kg (132 lb) to 130 before adding 10 lb', () => {
    expect(nextSuggestion([session([10, 60])], plan(1), 'lower', 'lb')?.weightKg).toBe(lb(140));
  });
});

describe('nextSuggestion: coming down', () => {
  it('drops 10% after two sessions in a row below the bottom of the range, to the nearest 5 lb', () => {
    const history = [session([7, lb(135)], [6, lb(135)], [8, lb(135)]), session([8, lb(135)], [7, lb(135)], [8, lb(135)])];
    // 135 × 0.9 = 121.5 → 120
    expect(nextSuggestion(history, plan(), 'upper', 'lb')).toEqual({
      change: 'down',
      fromWeightKg: lb(135),
      weightKg: lb(120),
      delta: -15,
    });
  });

  it('needs both misses at the same weight, so one miss after a drop does not drop again', () => {
    const s1 = session([6, 100], [6, 100]);
    const s2 = session([7, 100], [6, 100]);
    expect(nextSuggestion([s2, s1], plan(2), 'upper', 'kg')?.weightKg).toBe(90);
    const s3 = session([7, 90], [6, 90]);
    expect(nextSuggestion([s3, s2, s1], plan(2), 'upper', 'kg')).toBeNull();
    // A second miss at 90 drops again.
    expect(nextSuggestion([session([6, 90], [6, 90]), s3, s2], plan(2), 'upper', 'kg')?.weightKg).toBe(80);
  });

  it('rounds to the nearest 2.5 kg for kg users', () => {
    const history = [session([6, 62.5], [6, 62.5]), session([6, 62.5], [6, 62.5])];
    // 62.5 × 0.9 = 56.25 → 57.5 (nearest 2.5, halves round up)
    expect(nextSuggestion(history, plan(2), 'upper', 'kg')?.weightKg).toBe(57.5);
    const heavy = [session([3, 100]), session([4, 100])];
    expect(nextSuggestion(heavy, plan(1, 5, 5), 'lower', 'kg')?.weightKg).toBe(90);
  });

  it('is the same 10% for upper and lower body', () => {
    const history = [session([3, 100]), session([4, 100])];
    expect(nextSuggestion(history, plan(1, 5, 5), 'upper', 'kg')?.weightKg).toBe(90);
  });

  it('holds after only one session below the bottom', () => {
    expect(nextSuggestion([session([6, 60], [6, 60])], plan(2), 'upper', 'kg')).toBeNull();
    const history = [session([6, 60], [6, 60]), session([9, 60], [9, 60])];
    expect(nextSuggestion(history, plan(2), 'upper', 'kg')).toBeNull();
  });

  it('counts one done working set below the bottom as a miss; undone sets are not misses', () => {
    const history = [session([10, 60], [7, 60]), session([7, 60], [null, 60])];
    expect(nextSuggestion(history, plan(2), 'upper', 'kg')?.change).toBe('down');
    const undoneOnly = [session([8, 60], [null, 60]), session([7, 60])];
    expect(nextSuggestion(undoneOnly, plan(2), 'upper', 'kg')).toBeNull();
  });

  it('never suggests a drop that rounds back to the same weight or to nothing', () => {
    const light = [session([5, lb(5)]), session([5, lb(5)])];
    expect(nextSuggestion(light, plan(1), 'upper', 'lb')).toBeNull();
    const tiny = [session([5, 1]), session([5, 1])];
    expect(nextSuggestion(tiny, plan(1), 'upper', 'kg')).toBeNull();
  });
});

describe('nextSuggestion: when there is nothing to suggest', () => {
  const good = [session([10, 60], [10, 60], [10, 60])];

  it('lets the coach win when they typed a weight on any working set', () => {
    const base = plan();
    const p: Prescription = { ...base, sets: base.sets.map((x, i) => (i === 1 ? { ...x, weightKg: 70 } : x)) };
    expect(nextSuggestion(good, p, 'upper', 'kg')).toBeNull();
  });

  it('ignores a coach weight on a warm-up or drop (those are not working sets)', () => {
    const p: Prescription = { ...plan(), sets: [{ setType: 'warmup', repsMin: 5, repsMax: 5, weightKg: 20 }, ...plan().sets] };
    expect(nextSuggestion(good, p, 'upper', 'kg')?.change).toBe('up');
  });

  it('skips exercises not tracked by weight and reps', () => {
    for (const trackingType of ['reps', 'time', 'distance'] as const) {
      expect(nextSuggestion(good, { ...plan(), trackingType }, 'upper', 'kg')).toBeNull();
    }
  });

  it('skips bodyweight work (no weight, or 0, logged last time)', () => {
    expect(nextSuggestion([session([10, 0], [10, 0], [10, 0])], plan(), 'upper', 'kg')).toBeNull();
    const noWeight: ProgressionSession = { sets: [{ setType: 'normal', completed: true, reps: 10, weightKg: null }] };
    expect(nextSuggestion([noWeight], plan(1), 'upper', 'kg')).toBeNull();
  });

  it('needs a rep range on every working set', () => {
    expect(nextSuggestion(good, plan(3, null, null), 'upper', 'kg')).toBeNull();
  });

  it('needs at least one planned working set and some history', () => {
    expect(nextSuggestion(good, { trackingType: 'weight_reps', sets: [] }, 'upper', 'kg')).toBeNull();
    expect(nextSuggestion([], plan(), 'upper', 'kg')).toBeNull();
    expect(nextSuggestion([{ sets: [] }], plan(), 'upper', 'kg')).toBeNull();
  });
});

describe('progressionHint', () => {
  it('reads "↑ +5 lb" and "↓ −15 lb"', () => {
    expect(progressionHint({ change: 'up', fromWeightKg: 0, weightKg: 0, delta: 5 }, 'lb')).toBe('↑ +5 lb');
    expect(progressionHint({ change: 'down', fromWeightKg: 0, weightKg: 0, delta: -15 }, 'lb')).toBe('↓ −15 lb');
    expect(progressionHint({ change: 'up', fromWeightKg: 0, weightKg: 0, delta: 2.5 }, 'kg')).toBe('↑ +2.5 kg');
  });
});

describe('withSuggestion', () => {
  const last = [
    { setType: 'warmup' as const, actualReps: 5, actualWeightKg: 20, actualDurationS: null, actualDistanceM: null },
    { setType: 'normal' as const, actualReps: 10, actualWeightKg: 60, actualDurationS: null, actualDistanceM: null },
    { setType: 'normal' as const, actualReps: 10, actualWeightKg: 60, actualDurationS: null, actualDistanceM: null },
  ];
  const up = { change: 'up' as const, fromWeightKg: 60, weightKg: 62.5, delta: 2.5 };

  it('gives every working set of last time the suggested weight, keeping reps and warm-ups', () => {
    expect(withSuggestion(last, up).map((s) => [s.setType, s.actualReps, s.actualWeightKg])).toEqual([
      ['warmup', 5, 20],
      ['normal', 10, 62.5],
      ['normal', 10, 62.5],
    ]);
  });

  it('adds a working set when last time had none', () => {
    expect(withSuggestion([last[0]!], up)).toEqual([
      last[0],
      { setType: 'normal', actualReps: null, actualWeightKg: 62.5, actualDurationS: null, actualDistanceM: null },
    ]);
  });

  it('returns last time unchanged without a suggestion', () => {
    expect(withSuggestion(last, null)).toBe(last);
  });
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const target = { repsMin: 8, repsMax: 10, weightKg: null, durationS: null, distanceM: null, toFailure: false, restSeconds: 90 };
const logSet = (n: number, over: Partial<LogSetDoc> = {}): LogSetDoc => ({
  id: uuid(n),
  setType: 'normal',
  target,
  actualReps: null,
  actualWeightKg: null,
  actualDurationS: null,
  actualDistanceM: null,
  completedAt: null,
  ...over,
});
const logExercise = (id: number, exerciseId: string, sets: LogSetDoc[], over: Partial<LogExerciseDoc> = {}): LogExerciseDoc => ({
  id: uuid(id),
  exerciseId,
  exerciseName: 'Bench Press',
  trackingType: 'weight_reps',
  plannedWorkoutExerciseId: null,
  swappedFromExerciseId: null,
  note: null,
  sets,
  substituteId: null,
  substituteOptions: [],
  ...over,
});

describe('prescriptions', () => {
  it('reads a log exercise', () => {
    const ex = logExercise(1, uuid(100), [logSet(2, { setType: 'warmup', target: { ...target, weightKg: 20 } }), logSet(3)]);
    expect(prescriptionOfLogExercise(ex)).toEqual({
      trackingType: 'weight_reps',
      sets: [
        { setType: 'warmup', repsMin: 8, repsMax: 10, weightKg: 20 },
        { setType: 'normal', repsMin: 8, repsMax: 10, weightKg: null },
      ],
    });
  });

  it('reads a workout exercise', () => {
    const p = prescriptionOfWorkoutExercise({
      trackingType: 'weight_reps',
      sets: [
        {
          id: uuid(1),
          setType: 'normal',
          targetRepsMin: 6,
          targetRepsMax: 8,
          targetWeightKg: null,
          targetDurationS: null,
          targetDistanceM: null,
          toFailure: false,
          restSeconds: 90,
          note: null,
        },
      ],
    });
    expect(p).toEqual({ trackingType: 'weight_reps', sets: [{ setType: 'normal', repsMin: 6, repsMax: 8, weightKg: null }] });
  });
});

describe('progressionHistoryFromRows', () => {
  it('groups rows by exercise and session (1 = most recent), reading numbers sent as text', () => {
    const rows = [
      { exercise_id: 'a', session: 1, set_type: 'normal', completed: true, actual_reps: 10, actual_weight_kg: '60.000', primary_muscles: ['chest'] },
      { exercise_id: 'a', session: 1, set_type: 'normal', completed: false, actual_reps: null, actual_weight_kg: null, primary_muscles: ['chest'] },
      { exercise_id: 'a', session: 2, set_type: 'normal', completed: true, actual_reps: 7, actual_weight_kg: 60, primary_muscles: ['chest'] },
      { exercise_id: 'b', session: 1, set_type: 'warmup', completed: true, actual_reps: 5, actual_weight_kg: 40, primary_muscles: ['quadriceps'] },
    ];
    expect(progressionHistoryFromRows(rows)).toEqual({
      a: {
        region: 'upper',
        sessions: [
          {
            sets: [
              { setType: 'normal', completed: true, reps: 10, weightKg: 60 },
              { setType: 'normal', completed: false, reps: null, weightKg: null },
            ],
          },
          { sets: [{ setType: 'normal', completed: true, reps: 7, weightKg: 60 }] },
        ],
      },
      b: { region: 'lower', sessions: [{ sets: [{ setType: 'warmup', completed: true, reps: 5, weightKg: 40 }] }] },
    });
  });

  it('is empty for no rows or a non-array', () => {
    expect(progressionHistoryFromRows([])).toEqual({});
    expect(progressionHistoryFromRows(null)).toEqual({});
  });
});

describe('suggestionsForLog and the pre-fill', () => {
  const bench = uuid(100);
  const squat = uuid(101);
  const history = {
    [bench]: { region: 'upper' as const, sessions: [session([10, lb(135)], [10, lb(135)])] },
    [squat]: { region: 'lower' as const, sessions: [session([10, lb(225)], [10, lb(225)])] },
  };
  const log = (exercises: LogExerciseDoc[]): WorkoutLogDoc =>
    ({
      blocks: [{ id: uuid(900), sectionId: null, kind: 'straight', pickedExerciseId: null, exercises }],
    }) as unknown as WorkoutLogDoc;

  it('suggests per log exercise, keyed by its id', () => {
    const doc = log([logExercise(1, bench, [logSet(10), logSet(11)]), logExercise(2, squat, [logSet(12), logSet(13)])]);
    const out = suggestionsForLog(doc, history, 'lb');
    expect(out[uuid(1)]?.weightKg).toBe(lb(140));
    expect(out[uuid(2)]?.weightKg).toBe(lb(235));
  });

  it('leaves out exercises where the coach typed a weight or there is no history', () => {
    const doc = log([
      logExercise(1, bench, [logSet(10, { target: { ...target, weightKg: lb(150) } }), logSet(11)]),
      logExercise(2, uuid(102), [logSet(12)]),
    ]);
    expect(suggestionsForLog(doc, history, 'lb')).toEqual({});
  });

  it('pre-fills the suggested weight on every working set, with last time’s reps', () => {
    const ex = logExercise(1, bench, [logSet(10), logSet(11)]);
    const lastTime = [
      { setType: 'normal' as const, actualReps: 10, actualWeightKg: lb(135), actualDurationS: null, actualDistanceM: null },
      { setType: 'normal' as const, actualReps: 10, actualWeightKg: lb(135), actualDurationS: null, actualDistanceM: null },
    ];
    const s = suggestionsForLog(log([ex]), history, 'lb')[ex.id] ?? null;
    const adjusted = withSuggestion(lastTime, s);
    // The coach's top of the range is still the reps target.
    expect(resolveSetValues(ex, uuid(10), adjusted)).toMatchObject({ weightKg: lb(140), reps: 10 });
    expect(resolveSetValues(ex, uuid(11), adjusted).weightKg).toBe(lb(140));
    // A weight the client changed on set 1 still carries forward.
    const changed = { ...ex, sets: [logSet(10, { actualWeightKg: lb(145) }), logSet(11)] };
    expect(resolveSetValues(changed, uuid(11), adjusted).weightKg).toBe(lb(145));
  });
});

describe('suggestionForLogExercise and prefillLastTime', () => {
  const bench = uuid(100);
  const history = { [bench]: { region: 'upper' as const, sessions: [session([10, 60], [10, 60])] } };
  const lastTime = [{ setType: 'normal' as const, actualReps: 10, actualWeightKg: 60, actualDurationS: null, actualDistanceM: null }];

  it('suggests for the exercise actually being done', () => {
    const ex = logExercise(1, bench, [logSet(10), logSet(11)]);
    expect(suggestionForLogExercise(ex, history, 'kg')?.weightKg).toBe(62.5);
    expect(prefillLastTime(ex, lastTime, history, 'kg')[0]?.actualWeightKg).toBe(62.5);
  });

  it('leaves last time alone without history (Auto progression off) or with a coach weight', () => {
    const ex = logExercise(1, bench, [logSet(10)]);
    expect(prefillLastTime(ex, lastTime, {}, 'kg')).toBe(lastTime);
    const coach = logExercise(1, bench, [logSet(10, { target: { ...target, weightKg: 70 } })]);
    expect(suggestionForLogExercise(coach, history, 'kg')).toBeNull();
    expect(prefillLastTime(coach, lastTime, history, 'kg')).toBe(lastTime);
  });
});

describe('suggestionsForWorkout', () => {
  it('suggests per workout exercise, skipping ones with a coach weight', () => {
    const set = (n: number, weight: number | null) => ({
      id: uuid(n),
      setType: 'normal' as const,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetWeightKg: weight,
      targetDurationS: null,
      targetDistanceM: null,
      toFailure: false,
      restSeconds: 90,
      note: null,
    });
    const exercise = (id: number, exerciseId: string, weight: number | null) => ({
      id: uuid(id),
      exerciseId,
      exerciseName: 'Bench Press',
      trackingType: 'weight_reps' as const,
      note: null,
      sets: [set(id * 10, weight)],
      substitutes: [],
    });
    const doc = {
      blocks: [{ exercises: [exercise(1, uuid(100), null), exercise(2, uuid(101), 80)] }],
    } as unknown as WorkoutDoc;
    const history = {
      [uuid(100)]: { region: 'upper' as const, sessions: [session([10, 60])] },
      [uuid(101)]: { region: 'upper' as const, sessions: [session([10, 60])] },
    };
    expect(suggestionsForWorkout(doc, history, 'kg')).toEqual({
      [uuid(1)]: { change: 'up', fromWeightKg: 60, weightKg: 62.5, delta: 2.5 },
    });
  });
});
