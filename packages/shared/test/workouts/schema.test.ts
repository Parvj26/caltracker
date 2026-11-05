import { describe, expect, it } from 'vitest';
import { WorkoutDoc } from '../../src/workouts/schema';
import type { SetType } from '../../src/workouts/schema';
import type { TrackingType } from '../../src/exercises/tracking';

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

const set = (setType: SetType = 'normal', over: Record<string, unknown> = {}) => ({
  id: uuid(),
  setType,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetWeightKg: 60,
  targetDurationS: null,
  targetDistanceM: null,
  toFailure: false,
  restSeconds: setType === 'drop' ? 0 : 90,
  note: null,
  ...over,
});

const exercise = (sets: unknown[], trackingType: TrackingType = 'weight_reps') => ({
  id: uuid(),
  exerciseId: uuid(),
  exerciseName: 'Bench press',
  trackingType,
  note: null,
  sets,
});

const block = (kind: 'straight' | 'superset', exercises: unknown[]) => ({ id: uuid(), kind, exercises });
const doc = (blocks: unknown[]) => ({ id: uuid(), name: 'Upper A', notes: null, blocks });

function messages(input: unknown) {
  const r = WorkoutDoc.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => ({ message: i.message, path: i.path }));
}

describe('WorkoutDoc', () => {
  it('parses a straight block with warm-up, 3 normals and a drop', () => {
    const sets = [set('warmup'), set(), set(), set(), set('drop')];
    expect(WorkoutDoc.safeParse(doc([block('straight', [exercise(sets)])])).success).toBe(true);
  });

  it('parses a 2-exercise x 3-round superset', () => {
    const e = () => exercise([set(), set(), set()]);
    expect(WorkoutDoc.safeParse(doc([block('superset', [e(), e()])])).success).toBe(true);
  });

  it('trims the name', () => {
    const r = WorkoutDoc.parse({ ...doc([block('straight', [exercise([set()])])]), name: '  Upper A  ' });
    expect(r.name).toBe('Upper A');
  });

  it('requires at least one block', () => {
    expect(messages(doc([])).map((m) => m.message)).toContain('Add at least one exercise.');
  });

  it('rejects a straight block with two exercises', () => {
    const e = () => exercise([set()]);
    const m = messages(doc([block('straight', [e(), e()])]));
    expect(m).toContainEqual({
      message: 'A straight-sets block has exactly one exercise.',
      path: ['blocks', 0, 'exercises'],
    });
  });

  it('rejects a superset with one exercise', () => {
    const m = messages(doc([block('superset', [exercise([set()])])]));
    expect(m.map((x) => x.message)).toContain('A superset needs at least two exercises.');
  });

  it('rejects a leading drop set', () => {
    const m = messages(doc([block('straight', [exercise([set('drop'), set()])])]));
    expect(m).toContainEqual({
      message: 'A drop set must follow a normal or warm-up set.',
      path: ['blocks', 0, 'exercises', 0, 'sets', 0, 'setType'],
    });
  });

  it('rejects superset exercises with different round counts, ignoring drops', () => {
    const a = exercise([set(), set(), set('drop')]);
    const b = exercise([set(), set()]);
    expect(messages(doc([block('superset', [a, b])]))).toEqual([]);
    const d = exercise([set()]);
    expect(messages(doc([block('superset', [a, d])]))).toContainEqual({
      message: 'Every exercise in a superset needs the same number of rounds.',
      path: ['blocks', 0, 'exercises'],
    });
  });

  it('rejects min reps above max reps', () => {
    const m = messages(doc([block('straight', [exercise([set('normal', { targetRepsMin: 12, targetRepsMax: 8 })])])]));
    expect(m).toContainEqual({
      message: "Minimum reps can't be more than maximum reps.",
      path: ['blocks', 0, 'exercises', 0, 'sets', 0, 'targetRepsMin'],
    });
  });

  it('rejects targets that do not apply to the tracking type', () => {
    const timeSet = set('normal', { targetRepsMin: null, targetRepsMax: null, targetWeightKg: 20, targetDurationS: 30 });
    const m = messages(doc([block('straight', [exercise([timeSet], 'time')])]));
    expect(m).toContainEqual({
      message: "Weight doesn't apply to time.",
      path: ['blocks', 0, 'exercises', 0, 'sets', 0, 'targetWeightKg'],
    });
    const repsSet = set('normal', { targetWeightKg: 20 });
    expect(messages(doc([block('straight', [exercise([repsSet], 'reps')])])).map((x) => x.message)).toContain(
      "Weight doesn't apply to reps only.",
    );
    const distSet = set('normal', { targetWeightKg: null, targetDistanceM: 100 });
    expect(messages(doc([block('straight', [exercise([distSet], 'weight_reps')])])).map((x) => x.message)).toContain(
      "Distance doesn't apply to weight and reps.",
    );
    const durSet = set('normal', { targetDurationS: 10 });
    expect(messages(doc([block('straight', [exercise([durSet], 'weight_reps')])])).map((x) => x.message)).toContain(
      "Duration doesn't apply to weight and reps.",
    );
    const repSet = set('normal', { targetWeightKg: null, targetDistanceM: 100 });
    expect(messages(doc([block('straight', [exercise([repSet], 'distance')])])).map((x) => x.message)).toContain(
      "Reps doesn't apply to distance.",
    );
  });

  it('rejects to-failure on a non-drop set', () => {
    const m = messages(doc([block('straight', [exercise([set('normal', { toFailure: true })])])]));
    expect(m).toContainEqual({
      message: 'Only drop sets can be "to failure".',
      path: ['blocks', 0, 'exercises', 0, 'sets', 0, 'toFailure'],
    });
  });

  it('allows to-failure on a drop set', () => {
    const sets = [set(), set('drop', { toFailure: true })];
    expect(WorkoutDoc.safeParse(doc([block('straight', [exercise(sets)])])).success).toBe(true);
  });

  it('transforms a drop rest to 0', () => {
    const sets = [set(), set('drop', { restSeconds: 60 })];
    const r = WorkoutDoc.parse(doc([block('straight', [exercise(sets)])]));
    expect(r.blocks[0]?.exercises[0]?.sets[1]?.restSeconds).toBe(0);
    expect(r.blocks[0]?.exercises[0]?.sets[0]?.restSeconds).toBe(90);
  });

  it('enforces range limits', () => {
    const bad = (over: Record<string, unknown>) =>
      WorkoutDoc.safeParse(doc([block('straight', [exercise([set('normal', over)])])])).success;
    expect(bad({ targetRepsMin: 0 })).toBe(false);
    expect(bad({ targetWeightKg: 1001 })).toBe(false);
    expect(bad({ restSeconds: 3601 })).toBe(false);
    expect(bad({ note: 'x'.repeat(501) })).toBe(false);
  });
});
