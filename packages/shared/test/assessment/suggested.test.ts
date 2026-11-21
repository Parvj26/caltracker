import { describe, expect, it } from 'vitest';
import { MUSCLE_IDS, regionSides } from '../../src/anatomy/muscles';
import { BUILTIN_CORRECTIVES, checkCorrectiveTags, doseText } from '../../src/assessment/correctives';
import type { ConfirmedGroup } from '../../src/assessment/marks';
import {
  buildSuggestedWorkout,
  checkPicks,
  defaultPicks,
  exerciseOptions,
  livePicks,
  suggestedWorkoutName,
  type CorrectiveChoice,
} from '../../src/assessment/suggested';
import { WorkoutDoc } from '../../src/workouts/schema';

let n = 0;
const makeId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const uuid = (i: number) => `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

const choice = (over: Partial<CorrectiveChoice> & Pick<CorrectiveChoice, 'exerciseId' | 'name'>): CorrectiveChoice => ({
  trackingType: 'reps',
  imageUrl: null,
  direction: 'under',
  muscles: [
    { muscleId: 'glute_medius', side: 'L' },
    { muscleId: 'glute_medius', side: 'R' },
  ],
  dose: { sets: 2, reps: 5, seconds: null, eachSide: true },
  correctiveId: null,
  builtinKey: null,
  evidence: null,
  ...over,
});

const builtin = (key: string, exerciseId: string, extra: Partial<CorrectiveChoice> = {}): CorrectiveChoice => {
  const b = BUILTIN_CORRECTIVES.find((x) => x.key === key)!;
  return choice({
    exerciseId,
    name: b.libraryName,
    direction: b.direction,
    muscles: b.muscles.flatMap((m) => regionSides(m).map((side) => ({ muscleId: m, side }))),
    dose: b.dose,
    builtinKey: key,
    evidence: b.evidence,
    ...extra,
  });
};

const gluteMed: ConfirmedGroup = { muscleId: 'glute_medius', status: 'under', sides: ['L', 'R'], sources: ['ohs.knee_valgus'] };
const calves: ConfirmedGroup = { muscleId: 'calves', status: 'over', sides: ['L'], sources: ['ohs.heel_rise'] };
const labels = { 'ohs.knee_valgus': 'Knees cave in', 'ohs.heel_rise': 'Heels lift' };

describe('built-in correctives', () => {
  it('have unique keys and names and catalogue muscles', () => {
    expect(new Set(BUILTIN_CORRECTIVES.map((b) => b.key)).size).toBe(BUILTIN_CORRECTIVES.length);
    expect(new Set(BUILTIN_CORRECTIVES.map((b) => b.libraryName.toLowerCase())).size).toBe(BUILTIN_CORRECTIVES.length);
    for (const b of BUILTIN_CORRECTIVES) for (const m of b.muscles) expect(MUSCLE_IDS).toContain(m);
  });

  it('reads doses the way the boards write them', () => {
    expect(doseText({ sets: 2, reps: 5, seconds: null, eachSide: true })).toBe('2 × 5 each side');
    expect(doseText({ sets: 2, reps: null, seconds: 30, eachSide: false })).toBe('2 × 30 s');
    expect(doseText({ sets: 1, reps: null, seconds: 60, eachSide: false })).toBe('60 s');
    expect(doseText({ sets: 3, reps: null, seconds: null, eachSide: true })).toBe('3 sets each side');
  });
});

describe('exerciseOptions', () => {
  const dns = choice({ exerciseId: uuid(1), name: 'DNS Star', correctiveId: uuid(91) });
  const lateralWalk = builtin('banded_lateral_walk', uuid(2));
  const abduction = builtin('side_lying_hip_abduction', uuid(3));
  const clamshell = builtin('clamshell', uuid(4));
  const stepDown = builtin('step_down', uuid(5));
  const singleBridge = builtin('single_leg_glute_bridge', uuid(6));
  const calfStretch = builtin('standing_calf_stretch', uuid(7));

  it('puts the coach’s own first, then built-ins the findings recommend, up to four', () => {
    const [g] = exerciseOptions([gluteMed], [dns], [clamshell, singleBridge, abduction, lateralWalk, stepDown], labels);
    expect(g!.options.map((o) => o.name)).toEqual(['DNS Star', 'Banded Lateral Walk', 'Side-Lying Hip Abduction', 'Single Leg Glute Bridge']);
    expect(g!.options[0]).toMatchObject({ yours: true, forLabel: null });
    expect(g!.options[1]).toMatchObject({ yours: false, evidence: 'moderate', forLabel: 'knees cave in' });
  });

  it('matches direction and side, and shows a tagged built-in once, as the coach’s', () => {
    const leftOnly = choice({ exerciseId: uuid(8), name: 'Left thing', muscles: [{ muscleId: 'calves', side: 'R' }], direction: 'over' });
    const mine = { ...lateralWalk, correctiveId: uuid(92), builtinKey: null, evidence: null };
    const groups = exerciseOptions([gluteMed, calves], [mine, leftOnly], [lateralWalk, calfStretch], labels);
    expect(groups[0]!.options.map((o) => [o.name, o.yours])).toEqual([['Banded Lateral Walk', true]]);
    // calves L over: the R-only tag doesn't fit; the built-in stretch does.
    expect(groups[1]!.options.map((o) => o.name)).toEqual(['Calf Stretch Hands Against Wall']);
  });

  it('always offers one built-in even when the coach has four of their own', () => {
    const mine = [1, 2, 3, 4].map((i) => choice({ exerciseId: uuid(20 + i), name: `Mine ${i}`, correctiveId: uuid(30 + i) }));
    const [g] = exerciseOptions([gluteMed], mine, [lateralWalk], labels);
    expect(g!.options).toHaveLength(5);
  });

  it('picks the coach’s own by default, else the top built-in, and drops picks that no longer fit', () => {
    const groups = exerciseOptions([gluteMed, calves], [dns], [lateralWalk, calfStretch], labels);
    const picks = defaultPicks(groups);
    expect(picks.map((p) => p.exerciseId)).toEqual([uuid(1), uuid(7)]);
    expect(livePicks(groups, [...picks, { muscleId: 'lats', status: 'over', exerciseId: uuid(9) }])).toEqual(picks);
  });
});

describe('buildSuggestedWorkout', () => {
  const dns = choice({ exerciseId: uuid(1), name: 'DNS Star', correctiveId: uuid(91) });
  const calfStretch = builtin('standing_calf_stretch', uuid(7), { trackingType: 'time' });
  const lateralWalk = builtin('banded_lateral_walk', uuid(2), { trackingType: 'weight_reps' });

  it('makes one straight block per pick, in order, sets filled from each default', () => {
    const groups = exerciseOptions([gluteMed, calves], [dns], [lateralWalk, calfStretch], labels);
    const doc = buildSuggestedWorkout({
      name: suggestedWorkoutName('Vaishali'),
      groups,
      picks: [
        { muscleId: 'glute_medius', status: 'under', exerciseId: uuid(1) },
        { muscleId: 'glute_medius', status: 'under', exerciseId: uuid(2) },
        { muscleId: 'calves', status: 'over', exerciseId: uuid(7) },
      ],
      makeId,
    })!;
    expect(WorkoutDoc.safeParse(doc).success).toBe(true);
    expect(doc.name).toBe('Corrective – Vaishali');
    expect(doc.blocks.map((b) => b.exercises[0]!.exerciseName)).toEqual(['DNS Star', 'Banded Lateral Walk', 'Calf Stretch Hands Against Wall']);
    const [first, second, third] = doc.blocks.map((b) => b.exercises[0]!);
    expect(first!.sets).toHaveLength(2);
    expect(first!.sets[0]).toMatchObject({ targetRepsMin: 5, targetRepsMax: 5, targetDurationS: null, restSeconds: 45 });
    expect(first!.eachSide).toBe(true);
    expect(second!.sets).toHaveLength(3);
    expect(second!.sets[0]).toMatchObject({ targetRepsMin: 10, targetWeightKg: null });
    // A time exercise takes the seconds; reps don't apply to it.
    expect(third!.sets[0]).toMatchObject({ targetDurationS: 30, targetRepsMin: null });
  });

  it('adds an exercise picked for two muscles once, and nothing when nothing is picked', () => {
    const bothWays = choice({ exerciseId: uuid(1), name: 'DNS Star', muscles: [{ muscleId: 'glute_medius', side: 'L' }, { muscleId: 'calves', side: 'L' }] });
    const groups = exerciseOptions([gluteMed, { ...calves, status: 'under' }], [bothWays], []);
    const doc = buildSuggestedWorkout({ name: 'X', groups, picks: defaultPicks(groups), makeId });
    expect(doc!.blocks).toHaveLength(1);
    expect(buildSuggestedWorkout({ name: 'X', groups, picks: [], makeId })).toBeNull();
  });

  it('names the workout without a first name too', () => expect(suggestedWorkoutName(' ')).toBe('Corrective'));
});

describe('input checks', () => {
  it('checks picks', () => {
    const p = { muscleId: 'glute_medius', status: 'under', exerciseId: uuid(1) };
    expect(checkPicks([p])).toEqual([p]);
    expect(checkPicks([p, p])).toBeNull();
    expect(checkPicks([{ ...p, status: 'normal' }])).toBeNull();
    expect(checkPicks([{ ...p, exerciseId: 'x' }])).toBeNull();
  });

  it('checks corrective tags', () => {
    const good = { direction: 'under', muscles: [{ muscleId: 'glute_medius', side: 'L' }, { muscleId: 'abs', side: 'none' }], dose: { sets: 2, reps: 5, seconds: null, eachSide: true } };
    expect(checkCorrectiveTags(good)).toEqual(good);
    expect(checkCorrectiveTags({ ...good, muscles: [] })).toBeNull();
    expect(checkCorrectiveTags({ ...good, muscles: [{ muscleId: 'abs', side: 'L' }] })).toBeNull();
    expect(checkCorrectiveTags({ ...good, dose: { ...good.dose, seconds: 30 } })).toBeNull();
    expect(checkCorrectiveTags({ ...good, dose: { ...good.dose, sets: 0 } })).toBeNull();
    expect(checkCorrectiveTags({ ...good, direction: 'both' })).toBeNull();
  });
});
