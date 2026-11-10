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

const block = (kind: 'straight' | 'superset' | 'choice', exercises: unknown[]) => ({ id: uuid(), kind, exercises });
const doc = (blocks: unknown[]) => ({
  id: uuid(),
  name: 'Upper A',
  notes: null,
  blocks,
});
const sec = (name: string) => ({ id: uuid(), name });
const inSec = (b: object, s: { id: string } | null) => ({
  ...b,
  sectionId: s ? s.id : null,
});
const docS = (sections: unknown[], blocks: unknown[]) => ({
  ...doc(blocks),
  sections,
});
const one = () => block('straight', [exercise([set()])]);

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
    const r = WorkoutDoc.parse({
      ...doc([block('straight', [exercise([set()])])]),
      name: '  Upper A  ',
    });
    expect(r.name).toBe('Upper A');
  });

  it('asks for a name when it is blank', () => {
    expect(
      messages({
        ...doc([block('straight', [exercise([set()])])]),
        name: '   ',
      }),
    ).toEqual([{ message: 'Enter a name.', path: ['name'] }]);
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

  it('allows a superset whose exercises have different round counts', () => {
    const a = exercise([set(), set(), set()]);
    const b = exercise([set(), set()]);
    expect(messages(doc([block('superset', [a, b])]))).toEqual([]);
  });

  it('still needs two exercises in a superset when rounds differ', () => {
    expect(messages(doc([block('superset', [exercise([set(), set()])])])).map((x) => x.message)).toEqual([
      'A superset needs at least two exercises.',
    ]);
  });

  it('rejects min reps above max reps', () => {
    const m = messages(doc([block('straight', [exercise([set('normal', { targetRepsMin: 12, targetRepsMax: 8 })])])]));
    expect(m).toContainEqual({
      message: "Minimum reps can't be more than maximum reps.",
      path: ['blocks', 0, 'exercises', 0, 'sets', 0, 'targetRepsMin'],
    });
  });

  it('rejects targets that do not apply to the tracking type', () => {
    const timeSet = set('normal', {
      targetRepsMin: null,
      targetRepsMax: null,
      targetWeightKg: 20,
      targetDurationS: 30,
    });
    const m = messages(doc([block('straight', [exercise([timeSet], 'time')])]));
    expect(m).toContainEqual({
      message: "Weight doesn't apply to time.",
      path: ['blocks', 0, 'exercises', 0, 'sets', 0, 'targetWeightKg'],
    });
    const repsSet = set('normal', { targetWeightKg: 20 });
    expect(messages(doc([block('straight', [exercise([repsSet], 'reps')])])).map((x) => x.message)).toContain(
      "Weight doesn't apply to reps only.",
    );
    const distSet = set('normal', {
      targetWeightKg: null,
      targetDistanceM: 100,
    });
    expect(messages(doc([block('straight', [exercise([distSet], 'weight_reps')])])).map((x) => x.message)).toContain(
      "Distance doesn't apply to weight and reps.",
    );
    const durSet = set('normal', { targetDurationS: 10 });
    expect(messages(doc([block('straight', [exercise([durSet], 'weight_reps')])])).map((x) => x.message)).toContain(
      "Duration doesn't apply to weight and reps.",
    );
    const repSet = set('normal', {
      targetWeightKg: null,
      targetDistanceM: 100,
    });
    expect(messages(doc([block('straight', [exercise([repSet], 'distance')])])).map((x) => x.message)).toContain(
      "Reps doesn't apply to distance.",
    );
  });

  it('rejects to-failure on a warm-up', () => {
    const m = messages(doc([block('straight', [exercise([set('warmup', { toFailure: true }), set()])])]));
    expect(m).toContainEqual({
      message: 'A warm-up can\'t be "to failure".',
      path: ['blocks', 0, 'exercises', 0, 'sets', 0, 'toFailure'],
    });
  });

  it('allows to-failure on a normal set (F)', () => {
    const sets = [set(), set('normal', { toFailure: true })];
    expect(WorkoutDoc.safeParse(doc([block('straight', [exercise(sets)])])).success).toBe(true);
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

describe('WorkoutDoc sections and pick-one groups', () => {
  it('defaults sections to [] and sectionId to null', () => {
    const r = WorkoutDoc.parse(doc([one(), one()]));
    expect(r.sections).toEqual([]);
    expect(r.blocks.map((b) => b.sectionId)).toEqual([null, null]);
  });

  it('parses an Upper / Core style doc', () => {
    const [w, c, m, k] = [sec('Warm-Up'), sec('Core'), sec('Resistance Training'), sec('Cool-down')];
    const d = docS(
      [w, c, m, k],
      [inSec(one(), w), inSec(one(), c), inSec(one(), m), inSec(one(), m), inSec(one(), m), inSec(one(), k)],
    );
    expect(messages(d)).toEqual([]);
    expect(WorkoutDoc.parse(d).blocks[2]!.sectionId).toBe(m.id);
  });

  it('accepts a pick-one group of 2 to 5 exercises, with different set counts', () => {
    const e = (n: number) => exercise(Array.from({ length: n }, () => set()));
    expect(messages(doc([block('choice', [e(3), e(2)])]))).toEqual([]);
    expect(messages(doc([block('choice', [e(1), e(1), e(1), e(1), e(1)])]))).toEqual([]);
  });

  it('rejects a pick-one group of 1 or 6', () => {
    const e = () => exercise([set()]);
    for (const n of [1, 6]) {
      expect(messages(doc([block('choice', Array.from({ length: n }, e))]))).toContainEqual({
        message: 'A pick-one group needs 2 to 5 exercises.',
        path: ['blocks', 0, 'exercises'],
      });
    }
  });

  it('rejects an unknown section', () => {
    const d = docS([sec('Core')], [{ ...one(), sectionId: uuid() }]);
    expect(messages(d)).toContainEqual({
      message: 'Unknown section.',
      path: ['blocks', 0, 'sectionId'],
    });
  });

  it('keeps each section together and in order', () => {
    const [a, b] = [sec('A'), sec('B')];
    const together = "Keep each section's exercises together.";
    const unsectionedAfter = docS([a], [inSec(one(), a), one()]);
    expect(messages(unsectionedAfter).map((m) => m.message)).toContain(together);
    const split = docS([a, b], [inSec(one(), a), inSec(one(), b), inSec(one(), a)]);
    expect(messages(split).map((m) => m.message)).toContain(together);
    const outOfOrder = docS([a, b], [inSec(one(), b), inSec(one(), a)]);
    expect(messages(outOfOrder).map((m) => m.message)).toContain(together);
    expect(messages(docS([a], [one(), inSec(one(), a)]))).toEqual([]);
  });

  it('rejects a section with no exercise', () => {
    const [a, core] = [sec('A'), sec('Core')];
    expect(messages(docS([a, core], [inSec(one(), a)]))).toContainEqual({
      message: 'Add an exercise to Core or remove the section.',
      path: ['sections', 1],
    });
  });

  it('checks section names', () => {
    const base = (name: string) => {
      const s = sec(name);
      return docS([s], [inSec(one(), s)]);
    };
    expect(messages(base('   '))).toContainEqual({
      message: 'Name the section.',
      path: ['sections', 0, 'name'],
    });
    expect(messages(base('x'.repeat(41)))).toContainEqual({
      message: 'Keep section names to 40 characters.',
      path: ['sections', 0, 'name'],
    });
    expect(messages(base('x'.repeat(40)))).toEqual([]);
  });

  it('allows at most 10 sections', () => {
    const secs = Array.from({ length: 11 }, (_, i) => sec(`S${i}`));
    const d = docS(
      secs,
      secs.map((s) => inSec(one(), s)),
    );
    expect(messages(d).map((m) => m.message)).toContain('Use at most 10 sections.');
  });

  it('rejects two sections with the same id', () => {
    const a = sec('A');
    const d = docS([a, { ...a, name: 'B' }], [inSec(one(), a)]);
    expect(messages(d)).toContainEqual({
      message: 'Each section needs its own id.',
      path: ['sections', 1],
    });
  });
});
