import { describe, expect, it } from 'vitest';
import { addSection, addStraightBlock, addSuperset, emptyWorkout } from '../../src/workouts/doc-ops';
import { COPY_SUFFIX, copyName, duplicateWorkoutDoc } from '../../src/workouts/duplicate';
import { WorkoutDoc } from '../../src/workouts/schema';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let counter = 7000;
const makeId = () => ID(++counter);
const pick = (n: number) => ({ id: ID(n), name: `Exercise ${n}`, trackingType: 'weight_reps' as const });

describe('copyName', () => {
  it('adds " (copy)"', () => {
    expect(copyName('Upper A')).toBe('Upper A (copy)');
    expect(copyName('  Upper A  ')).toBe('Upper A (copy)');
    expect(COPY_SUFFIX).toBe(' (copy)');
  });
  it('shortens a long name so the copy still fits the limit', () => {
    const long = 'x'.repeat(100);
    expect(copyName(long)).toHaveLength(100);
    expect(copyName(long).endsWith(' (copy)')).toBe(true);
    expect(copyName(`${'a'.repeat(92)} bbbbbbb`, 100)).toBe(`${'a'.repeat(92)} (copy)`);
  });
});

describe('duplicateWorkoutDoc', () => {
  function doc() {
    let d = emptyWorkout(makeId, 'Upper A');
    d = addStraightBlock(d, pick(1), makeId);
    d = addSection(d, 'Main', makeId);
    d = addSuperset(d, [pick(2), pick(3)], makeId);
    d = { ...d, notes: 'Go easy' };
    return WorkoutDoc.parse(d);
  }

  it('gives every row a new id and keeps everything else', () => {
    const d = doc();
    const copy = duplicateWorkoutDoc(d, makeId);
    const ids = (w: WorkoutDoc) => [
      w.id,
      ...w.sections.map((s) => s.id),
      ...w.blocks.flatMap((b) => [b.id, ...b.exercises.flatMap((e) => [e.id, ...e.sets.map((s) => s.id)])]),
    ];
    const before = new Set(ids(d));
    expect(ids(copy).some((i) => before.has(i))).toBe(false);
    expect(new Set(ids(copy)).size).toBe(ids(copy).length);
    expect(copy.name).toBe('Upper A (copy)');
    expect(copy.notes).toBe('Go easy');
    expect(copy.blocks.map((b) => b.kind)).toEqual(['straight', 'superset']);
    expect(copy.blocks[1]!.exercises.map((e) => e.exerciseId)).toEqual([ID(2), ID(3)]);
    expect(copy.blocks[1]!.exercises[0]!.sets.map((s) => s.restSeconds)).toEqual([0, 0, 0]);
  });

  it('points blocks at the new section ids, and the copy is valid', () => {
    const copy = duplicateWorkoutDoc(doc(), makeId);
    expect(copy.blocks[0]!.sectionId).toBeNull();
    expect(copy.blocks[1]!.sectionId).toBe(copy.sections[0]!.id);
    expect(WorkoutDoc.parse(copy)).toBeTruthy();
  });
});
