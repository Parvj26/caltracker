import { describe, expect, it } from 'vitest';
import {
  addExerciseToSuperset,
  addRound,
  removeRound,
  addChoice,
  addStraightBlock,
  addSubstitute,
  addSubstituteDrop,
  addSubstituteSet,
  addSuperset,
  emptyWorkout,
  removeSubstitute,
  removeSubstituteSet,
  replaceExercise,
  setShowsRest,
  substituteSetShowsRest,
  updateSet,
  updateSubstitute,
  updateSubstituteSet,
} from '../../src/workouts/doc-ops';
import type { ExercisePick } from '../../src/workouts/doc-ops';
import { WorkoutDoc } from '../../src/workouts/schema';
import { WORKOUT_TREE_SELECT, workoutRowToDoc } from '../../src/workouts/tree';
import type { WorkoutTreeRow, WorkoutTreeSubstituteRow } from '../../src/workouts/tree';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let counter = 5000;
const makeId = () => ID(++counter);
const pick = (n: number, trackingType: ExercisePick['trackingType'] = 'weight_reps'): ExercisePick => ({
  id: ID(n),
  name: `Exercise ${n}`,
  trackingType,
});
const valid = (d: unknown) => WorkoutDoc.safeParse(d).success;
const messages = (d: unknown) => {
  const r = WorkoutDoc.safeParse(d);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

function base() {
  let d = emptyWorkout(makeId, 'Back');
  d = addStraightBlock(d, pick(1), makeId);
  d = addSuperset(d, [pick(2), pick(3)], makeId);
  d = addChoice(d, [pick(4), pick(5)], makeId);
  d = updateSet(d, d.blocks[0]!.id, d.blocks[0]!.exercises[0]!.id, d.blocks[0]!.exercises[0]!.sets[0]!.id, {
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetWeightKg: 50,
  });
  return WorkoutDoc.parse(d);
}
const at = (d: WorkoutDoc, bi: number, ei = 0) => ({ b: d.blocks[bi]!, e: d.blocks[bi]!.exercises[ei]! });

describe('substitutes in a workout doc', () => {
  it('a doc saved before substitutes parses with none', () => {
    const d = base();
    const old = JSON.parse(JSON.stringify(d)) as { blocks: Array<{ exercises: Array<Record<string, unknown>> }> };
    for (const b of old.blocks) for (const e of b.exercises) delete e.substitutes;
    const parsed = WorkoutDoc.parse(old);
    expect(parsed.blocks.every((b) => b.exercises.every((e) => e.substitutes.length === 0))).toBe(true);
  });

  it('addSubstitute copies the exercise sets with new ids', () => {
    const d = base();
    const { b, e } = at(d, 0);
    const out = addSubstitute(d, b.id, e.id, pick(10), makeId);
    const sub = at(out, 0).e.substitutes[0]!;
    expect(sub).toMatchObject({ exerciseId: ID(10), exerciseName: 'Exercise 10', trackingType: 'weight_reps', note: null });
    const noId = (s: { id: string }) => ({ ...s, id: 'x' });
    expect(sub.sets.map(noId)).toEqual(e.sets.map(noId));
    expect(sub.sets.some((s) => e.sets.some((x) => x.id === s.id))).toBe(false);
    expect(valid(out)).toBe(true);
    expect(d.blocks[0]!.exercises[0]!.substitutes).toEqual([]); // input untouched
  });

  it('drops targets the substitute tracking type does not use', () => {
    const d = base();
    const { b, e } = at(d, 0);
    const out = addSubstitute(d, b.id, e.id, pick(11, 'reps'), makeId);
    const s = at(out, 0).e.substitutes[0]!.sets[0]!;
    expect(s).toMatchObject({ targetRepsMin: 8, targetRepsMax: 10, targetWeightKg: null });
    expect(valid(out)).toBe(true);
  });

  it('works in a superset', () => {
    const d = base();
    const { b, e } = at(d, 1, 1);
    const out = addSubstitute(d, b.id, e.id, pick(12), makeId);
    expect(at(out, 1, 1).e.substitutes).toHaveLength(1);
    expect(valid(out)).toBe(true);
  });

  it('is refused in a pick-one group, past 3, for the exercise itself and for a repeat', () => {
    const d = base();
    const choice = at(d, 2);
    expect(addSubstitute(d, choice.b.id, choice.e.id, pick(10), makeId)).toBe(d);
    const { b, e } = at(d, 0);
    expect(addSubstitute(d, b.id, e.id, pick(1), makeId)).toBe(d);
    let out = addSubstitute(d, b.id, e.id, pick(10), makeId);
    expect(addSubstitute(out, b.id, e.id, pick(10), makeId)).toBe(out);
    out = addSubstitute(out, b.id, e.id, pick(11), makeId);
    out = addSubstitute(out, b.id, e.id, pick(12), makeId);
    expect(addSubstitute(out, b.id, e.id, pick(13), makeId)).toBe(out);
    expect(at(out, 0).e.substitutes).toHaveLength(3);
    expect(addSubstitute(d, 'nope', e.id, pick(10), makeId)).toBe(d);
  });

  it('removeSubstitute and updateSubstitute', () => {
    const d0 = base();
    const { b, e } = at(d0, 0);
    const d = addSubstitute(d0, b.id, e.id, pick(10), makeId);
    const sub = at(d, 0).e.substitutes[0]!;
    const noted = updateSubstitute(d, b.id, e.id, sub.id, { note: 'Blue band' });
    expect(at(noted, 0).e.substitutes[0]!.note).toBe('Blue band');
    expect(updateSubstitute(noted, b.id, e.id, sub.id, { note: 'Blue band' })).toBe(noted);
    expect(updateSubstitute(d, b.id, e.id, 'nope', { note: 'x' })).toBe(d);
    expect(at(removeSubstitute(d, b.id, e.id, sub.id), 0).e.substitutes).toEqual([]);
    expect(removeSubstitute(d, b.id, e.id, 'nope')).toBe(d);
  });

  it('substitute set ops follow the exercise set rules', () => {
    const d0 = base();
    const { b, e } = at(d0, 0);
    const d = addSubstitute(d0, b.id, e.id, pick(10), makeId);
    const sub = () => at(cur, 0).e.substitutes[0]!;
    let cur = d;
    cur = addSubstituteSet(cur, b.id, e.id, sub().id, makeId);
    expect(sub().sets).toHaveLength(4);
    expect(sub().sets[3]).toMatchObject({ targetRepsMin: e.sets[2]!.targetRepsMin, setType: 'normal' });
    cur = addSubstituteDrop(cur, b.id, e.id, sub().id, sub().sets[0]!.id, makeId);
    expect(sub().sets[1]!.setType).toBe('drop');
    expect(sub().sets[1]!.restSeconds).toBe(0);
    const before = cur;
    expect(updateSubstituteSet(cur, b.id, e.id, sub().id, sub().sets[0]!.id, { setType: 'drop' })).toBe(before);
    cur = updateSubstituteSet(cur, b.id, e.id, sub().id, sub().sets[2]!.id, { targetWeightKg: 30 });
    expect(sub().sets[2]!.targetWeightKg).toBe(30);
    cur = removeSubstituteSet(cur, b.id, e.id, sub().id, sub().sets[0]!.id); // takes its drop too
    expect(sub().sets).toHaveLength(3);
    expect(sub().sets[0]!.setType).toBe('normal');
    cur = removeSubstituteSet(cur, b.id, e.id, sub().id, sub().sets[0]!.id);
    cur = removeSubstituteSet(cur, b.id, e.id, sub().id, sub().sets[0]!.id);
    const last = cur;
    expect(removeSubstituteSet(cur, b.id, e.id, sub().id, sub().sets[0]!.id)).toBe(last);
    expect(valid(cur)).toBe(true);
    // The planned exercise's sets never move.
    expect(at(cur, 0).e.sets).toEqual(e.sets);
  });

  it('substituteSetShowsRest mirrors the exercise it stands in for', () => {
    const d0 = base();
    const { b, e } = at(d0, 1, 0);
    const d = addSubstitute(d0, b.id, e.id, pick(10), makeId);
    const block = d.blocks[1]!;
    const sub = block.exercises[0]!.substitutes[0]!;
    expect(substituteSetShowsRest(block, 0, sub, 0)).toBe(setShowsRest(block, 0, 0));
    expect(substituteSetShowsRest(block, 0, sub, 0)).toBe(false);
    expect(substituteSetShowsRest(block, 9, sub, 0)).toBe(false);
  });

  it('replaceExercise drops a substitute that would be the exercise itself', () => {
    const d0 = base();
    const { b, e } = at(d0, 0);
    let d = addSubstitute(d0, b.id, e.id, pick(10), makeId);
    d = addSubstitute(d, b.id, e.id, pick(11), makeId);
    const out = replaceExercise(d, b.id, e.id, pick(10));
    expect(at(out, 0).e.substitutes.map((s) => s.exerciseId)).toEqual([ID(11)]);
    expect(valid(out)).toBe(true);
  });

  it('the schema refuses substitutes in a pick-one group, repeats, more than 3 and bad sets', () => {
    const d = base();
    const { b, e } = at(d, 0);
    const withSub = addSubstitute(d, b.id, e.id, pick(10), makeId);
    const sub = at(withSub, 0).e.substitutes[0]!;
    const set = (over: object) => ({ ...withSub, blocks: withSub.blocks.map((x, i) => (i === 0 ? { ...x, exercises: [{ ...x.exercises[0]!, substitutes: [{ ...sub, ...over }] }] } : x)) });
    expect(messages(set({ exerciseId: e.exerciseId }))).toContain('A substitute must be a different exercise.');
    expect(messages(set({ trackingType: 'reps' }))).toContain("Weight doesn't apply to reps only.");
    expect(messages(set({ sets: [{ ...sub.sets[0]!, setType: 'drop' }] }))).toContain('A drop set must follow a normal or warm-up set.');
    const choice = { ...d, blocks: d.blocks.map((x, i) => (i === 2 ? { ...x, exercises: x.exercises.map((o, oi) => (oi === 0 ? { ...o, substitutes: [{ ...sub, exerciseId: ID(77) }] } : o)) } : x)) };
    expect(messages(choice)).toContain("A pick-one group's exercises can't have substitutes.");
    const four = { ...withSub, blocks: withSub.blocks.map((x, i) => (i === 0 ? { ...x, exercises: [{ ...x.exercises[0]!, substitutes: [10, 11, 12, 13].map((n) => ({ ...sub, id: ID(n + 100), exerciseId: ID(n) })) }] } : x)) };
    expect(messages(four)).toContain('Use at most 3 substitutes.');
  });

  it('the parse gives a substitute drop set no rest', () => {
    const d0 = base();
    const { b, e } = at(d0, 0);
    const d = addSubstitute(d0, b.id, e.id, pick(10), makeId);
    const sub = at(d, 0).e.substitutes[0]!;
    const raw = { ...d, blocks: d.blocks.map((x, i) => (i === 0 ? { ...x, exercises: [{ ...x.exercises[0]!, substitutes: [{ ...sub, sets: [sub.sets[0]!, { ...sub.sets[1]!, setType: 'drop', restSeconds: 60 }] }] }] } : x)) };
    expect(WorkoutDoc.parse(raw).blocks[0]!.exercises[0]!.substitutes[0]!.sets[1]!.restSeconds).toBe(0);
  });
});

describe('workoutRowToDoc with substitutes', () => {
  const exRow = (substitutes?: WorkoutTreeRow['workout_blocks'][number]['workout_exercises'][number]['workout_substitutes']) => ({
    id: ID(1),
    name: 'Back',
    notes: null,
    client_id: null,
    scheduled_on: null,
    workout_blocks: [
      {
        id: ID(2),
        position: 0,
        kind: 'straight' as const,
        section_id: null,
        section_name: null,
        workout_exercises: [
          {
            id: ID(3),
            position: 0,
            exercise_id: ID(4),
            note: null,
            exercises: { name: 'Lat Pulldown', tracking_type: 'weight_reps' as const },
            workout_sets: [
              { id: ID(5), position: 0, set_type: 'normal' as const, target_reps_min: 8, target_reps_max: 10, target_weight_kg: '50', target_duration_s: null, target_distance_m: null, to_failure: false, rest_seconds: 90, note: null },
            ],
            ...(substitutes ? { workout_substitutes: substitutes } : {}),
          },
        ],
      },
    ],
  });

  it('has no substitutes when the row has none (or predates them)', () => {
    expect(workoutRowToDoc(exRow()).blocks[0]!.exercises[0]!.substitutes).toEqual([]);
    expect(workoutRowToDoc(exRow([])).blocks[0]!.exercises[0]!.substitutes).toEqual([]);
  });

  it('reads substitutes in position order, with their jsonb sets fitted to the live tracking type', () => {
    const sets = [{ id: ID(20), setType: 'normal', targetRepsMin: 6, targetRepsMax: 8, targetWeightKg: 20, targetDurationS: null, targetDistanceM: null, toFailure: false, restSeconds: 90, note: null }];
    const doc = workoutRowToDoc(
      exRow([
        { id: ID(11), position: 1, exercise_id: ID(13), note: null, sets, exercises: { name: 'Band Pull Up', tracking_type: 'reps' } },
        { id: ID(10), position: 0, exercise_id: ID(12), note: 'If taken', sets, exercises: { name: 'Machine Assisted Pull Up', tracking_type: 'weight_reps' } },
      ]),
    );
    const subs = doc.blocks[0]!.exercises[0]!.substitutes;
    expect(subs.map((s) => s.exerciseName)).toEqual(['Machine Assisted Pull Up', 'Band Pull Up']);
    expect(subs[0]).toMatchObject({ id: ID(10), exerciseId: ID(12), note: 'If taken', trackingType: 'weight_reps' });
    expect(subs[0]!.sets[0]).toMatchObject({ targetWeightKg: 20, targetRepsMin: 6 });
    expect(subs[1]!.sets[0]!.targetWeightKg).toBeNull();
    expect(WorkoutDoc.safeParse(doc).success).toBe(true);
  });
});

it('the tree select reads substitutes with their exercise', () => {
  expect(WORKOUT_TREE_SELECT).toContain('workout_substitutes(id, position, exercise_id, note, sets, exercises(name, tracking_type))');
});

describe('superset rounds keep substitutes in step', () => {
  function ss() {
    let d = emptyWorkout(makeId, 'SS');
    d = addSuperset(d, [pick(2), pick(3)], makeId);
    const b = d.blocks[0]!;
    d = addSubstitute(d, b.id, b.exercises[0]!.id, pick(20), makeId);
    d = addSubstitute(d, b.id, b.exercises[1]!.id, pick(21), makeId);
    return WorkoutDoc.parse(d);
  }
  const nonDrop = (sets: Array<{ setType: string }>) => sets.filter((s) => s.setType !== 'drop').length;

  it('addRound adds a set to every substitute, with the rest of the exercise it stands in for', () => {
    const d = ss();
    const out = addRound(d, d.blocks[0]!.id, makeId);
    const [a, b] = out.blocks[0]!.exercises;
    expect(a!.substitutes[0]!.sets).toHaveLength(4);
    expect(b!.substitutes[0]!.sets).toHaveLength(4);
    expect(a!.substitutes[0]!.sets[3]!.restSeconds).toBe(0);
    expect(b!.substitutes[0]!.sets[3]!.restSeconds).toBe(b!.sets[3]!.restSeconds);
    expect(valid(out)).toBe(true);
  });

  it('removeRound removes it again, but a substitute always keeps one working set', () => {
    const d = ss();
    const out = removeRound(d, d.blocks[0]!.id);
    expect(out.blocks[0]!.exercises.map((e) => nonDrop(e.substitutes[0]!.sets))).toEqual([2, 2]);
    // A substitute trimmed to one set keeps it while its exercise loses the round.
    const b = d.blocks[0]!;
    const sub = b.exercises[0]!.substitutes[0]!;
    let one = removeSubstituteSet(d, b.id, b.exercises[0]!.id, sub.id, sub.sets[0]!.id);
    one = removeSubstituteSet(one, b.id, b.exercises[0]!.id, sub.id, sub.sets[1]!.id);
    const trimmed = removeRound(one, b.id);
    expect(nonDrop(trimmed.blocks[0]!.exercises[0]!.sets)).toBe(2);
    expect(nonDrop(trimmed.blocks[0]!.exercises[0]!.substitutes[0]!.sets)).toBe(1);
    expect(valid(trimmed)).toBe(true);
  });

  it('adding an exercise to the superset moves the round rest off the old last exercise and its substitutes', () => {
    const d = ss();
    const out = addExerciseToSuperset(d, d.blocks[0]!.id, pick(4), makeId);
    const old = out.blocks[0]!.exercises[1]!;
    expect(old.sets.every((s) => s.restSeconds === 0)).toBe(true);
    expect(old.substitutes[0]!.sets.every((s) => s.restSeconds === 0)).toBe(true);
  });
});

describe('workoutRowToDoc skips substitute rows that would make the doc invalid', () => {
  const goodSet = (n: number) => ({ id: ID(n), setType: 'normal', targetRepsMin: 8, targetRepsMax: 8, targetWeightKg: 20, targetDurationS: null, targetDistanceM: null, toFailure: false, restSeconds: 90, note: null });
  const row = (kind: 'straight' | 'choice', subs: Array<Record<string, unknown>>): WorkoutTreeRow => ({
    id: ID(1), name: 'Back', notes: null, client_id: null, scheduled_on: null,
    workout_blocks: [{
      id: ID(2), position: 0, kind, section_id: null, section_name: null,
      workout_exercises: [0, 1].slice(0, kind === 'choice' ? 2 : 1).map((k) => ({
        id: ID(3 + k), position: k, exercise_id: ID(40 + k), note: null,
        exercises: { name: `Ex ${k}`, tracking_type: 'weight_reps' as const },
        workout_sets: [{ id: ID(60 + k), position: 0, set_type: 'normal' as const, target_reps_min: 8, target_reps_max: 8, target_weight_kg: 50, target_duration_s: null, target_distance_m: null, to_failure: false, rest_seconds: 90, note: null }],
        workout_substitutes: k === 0 ? (subs as unknown as WorkoutTreeSubstituteRow[]) : [],
      })),
    }],
  });
  const sub = (n: number, exerciseId: string, sets: unknown) => ({ id: ID(n), position: n, exercise_id: exerciseId, note: null, sets, exercises: { name: `Sub ${n}`, tracking_type: 'weight_reps' } });

  it('keeps good ones, drops bad sets, and leaves out bad, repeated, self and extra substitutes', () => {
    const doc = workoutRowToDoc(row('straight', [
      sub(100, ID(80), [goodSet(200), { ...goodSet(201), id: 'not-a-uuid' }, { ...goodSet(202), targetRepsMin: -3 }]),
      sub(101, ID(40), [goodSet(203)]), // the planned exercise itself
      sub(102, ID(80), [goodSet(204)]), // a repeat
      sub(103, ID(81), [{ ...goodSet(205), setType: 'drop', restSeconds: 0 }]), // starts with a drop
      sub(104, ID(82), 'garbage'),
      sub(105, ID(83), [goodSet(206)]),
      sub(106, ID(84), [goodSet(207)]),
      sub(107, ID(85), [goodSet(208)]), // a 4th good one
    ]));
    const subs = doc.blocks[0]!.exercises[0]!.substitutes;
    expect(subs.map((s) => s.exerciseId)).toEqual([ID(80), ID(83), ID(84)]);
    expect(subs[0]!.sets.map((s) => s.id)).toEqual([ID(200)]);
    expect(WorkoutDoc.safeParse(doc).success).toBe(true);
  });

  it('gives a pick-one group no substitutes', () => {
    const doc = workoutRowToDoc(row('choice', [sub(100, ID(80), [goodSet(200)])]));
    expect(doc.blocks[0]!.exercises[0]!.substitutes).toEqual([]);
    expect(WorkoutDoc.safeParse(doc).success).toBe(true);
  });
});
