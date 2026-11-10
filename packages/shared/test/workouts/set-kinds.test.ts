import { describe, expect, it } from 'vitest';
import { SET_KINDS, SET_KIND_NAMES, setKindOf, setKindPatch, singleReps, withSingleReps } from '../../src/workouts/set-kinds';
import { WorkoutDoc } from '../../src/workouts/schema';
import type { SetType } from '../../src/workouts/schema';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let counter = 0;
const set = (setType: SetType, over: Record<string, unknown> = {}) => ({
  id: ID(++counter),
  setType,
  targetRepsMin: null,
  targetRepsMax: null,
  targetWeightKg: null,
  targetDurationS: null,
  targetDistanceM: null,
  toFailure: false,
  restSeconds: setType === 'drop' ? 0 : 90,
  note: null,
  ...over,
});

describe('set kinds (W / N / F / D)', () => {
  it('lists the four letters in menu order with their names', () => {
    expect(SET_KINDS).toEqual(['W', 'N', 'F', 'D']);
    expect(SET_KINDS.map((k) => SET_KIND_NAMES[k])).toEqual(['Warm-up', 'Normal', 'Failure', 'Drop set']);
  });

  it('reads a set as its letter: to failure wins over drop, so an older "drop to failure" still reads F', () => {
    expect(setKindOf({ setType: 'warmup', toFailure: false })).toBe('W');
    expect(setKindOf({ setType: 'normal', toFailure: false })).toBe('N');
    expect(setKindOf({ setType: 'normal', toFailure: true })).toBe('F');
    expect(setKindOf({ setType: 'drop', toFailure: false })).toBe('D');
    expect(setKindOf({ setType: 'drop', toFailure: true })).toBe('F');
  });

  it('maps each letter onto the existing set_type and to_failure columns', () => {
    expect(setKindPatch('W')).toEqual({ setType: 'warmup', toFailure: false });
    expect(setKindPatch('N')).toEqual({ setType: 'normal', toFailure: false });
    expect(setKindPatch('F')).toEqual({ setType: 'normal', toFailure: true });
    expect(setKindPatch('D')).toEqual({ setType: 'drop', toFailure: false });
    for (const k of SET_KINDS) expect(setKindOf(setKindPatch(k))).toBe(k);
  });
});

describe('single rep targets', () => {
  it('a range becomes its top number; one number stays; nothing stays nothing', () => {
    expect(singleReps(10, 12)).toBe(12);
    expect(singleReps(8, 8)).toBe(8);
    expect(singleReps(5, null)).toBe(5);
    expect(singleReps(null, 9)).toBe(9);
    expect(singleReps(null, null)).toBeNull();
  });

  it('withSingleReps turns every range in a workout (substitutes too) into its top number, and leaves the rest alone', () => {
    const range = set('normal', { targetRepsMin: 10, targetRepsMax: 12, targetWeightKg: 40, note: 'old note' });
    const single = set('normal', { targetRepsMin: 8, targetRepsMax: 8 });
    const subRange = set('normal', { targetRepsMin: 6, targetRepsMax: 9 });
    const doc = WorkoutDoc.parse({
      id: ID(900),
      name: 'Upper',
      notes: null,
      blocks: [
        {
          id: ID(901),
          kind: 'straight',
          exercises: [
            {
              id: ID(902),
              exerciseId: ID(903),
              exerciseName: 'Bench',
              trackingType: 'weight_reps',
              note: null,
              sets: [range, single],
              substitutes: [
                { id: ID(904), exerciseId: ID(905), exerciseName: 'DB Bench', trackingType: 'weight_reps', note: null, sets: [subRange] },
              ],
            },
          ],
        },
      ],
    });
    const out = withSingleReps(doc);
    const ex = out.blocks[0]!.exercises[0]!;
    expect(ex.sets[0]).toEqual({ ...range, targetRepsMin: 12, targetRepsMax: 12 });
    expect(ex.sets[1]).toBe(doc.blocks[0]!.exercises[0]!.sets[1]);
    expect(ex.substitutes[0]!.sets[0]).toMatchObject({ targetRepsMin: 9, targetRepsMax: 9 });
    expect(WorkoutDoc.safeParse(out).success).toBe(true);
    // Nothing to change: the same doc comes back.
    expect(withSingleReps(out)).toBe(out);
  });
});
