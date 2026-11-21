import { describe, expect, it } from 'vitest';
import {
  builtinItems,
  coachItems,
  filterLibrary,
  groupLibrary,
  exerciseStep,
  isExercisePhotoPath,
  libraryMuscles,
  mergeLibrary,
  muscleTagLabel,
  tagsByMuscle,
  toggleTag,
  type CoachCorrectiveRow,
} from './corrective-library';

const WS = '11111111-1111-4111-8111-111111111111';
const EX = '22222222-2222-4222-8222-222222222222';
const FILE = '33333333-3333-4333-8333-333333333333';

const builtinRows = [
  { id: 'b-bridge', name: 'Glute Bridge', tracking_type: 'reps', image_paths: ['free/bridge.jpg'] },
  { id: 'b-walk', name: 'banded lateral walk', tracking_type: 'reps', image_paths: [] },
  { id: 'b-calf', name: 'Calf Stretch Hands Against Wall', tracking_type: 'time', image_paths: [] },
];

const coachRow = (over: Partial<CoachCorrectiveRow> = {}): CoachCorrectiveRow => ({
  id: 'c1',
  exercise_id: 'dns',
  direction: 'under',
  default_sets: 2,
  default_reps: 5,
  default_seconds: null,
  each_side: true,
  muscles: [
    { muscle_id: 'glute_medius', side: 'R' },
    { muscle_id: 'glute_medius', side: 'L' },
  ],
  exercise: { name: 'DNS Star', tracking_type: 'reps', image_paths: [], source: 'custom' },
  ...over,
});

describe('builtinItems', () => {
  it('finds built-in exercises by name, ignoring case, in the defaults order, tagging both sides', () => {
    const items = builtinItems(builtinRows);
    expect(items.map((i) => i.name)).toEqual(['Calf Stretch Hands Against Wall', 'banded lateral walk', 'Glute Bridge']);
    const walk = items.find((i) => i.builtinKey === 'banded_lateral_walk')!;
    expect(walk.exerciseId).toBe('b-walk');
    expect(walk.yours).toBe(false);
    expect(walk.muscles).toContainEqual({ muscleId: 'glute_medius', side: 'L' });
    expect(walk.muscles).toContainEqual({ muscleId: 'glute_medius', side: 'R' });
    expect(items.find((i) => i.name === 'Glute Bridge')!.imagePath).toBe('free/bridge.jpg');
  });

  it('leaves out defaults whose exercise is not in the library', () => {
    expect(builtinItems([]).length).toBe(0);
  });
});

describe('coachItems', () => {
  it('maps rows, sorts tags L before R, and drops rows without an exercise', () => {
    const items = coachItems([coachRow(), coachRow({ id: 'gone', exercise: null })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'c:c1', yours: true, custom: true, correctiveId: 'c1', dose: { sets: 2, reps: 5, seconds: null, eachSide: true } });
    expect(items[0]!.muscles).toEqual([
      { muscleId: 'glute_medius', side: 'L' },
      { muscleId: 'glute_medius', side: 'R' },
    ]);
  });
});

describe('mergeLibrary', () => {
  it('puts yours first and shows a built-in the coach tagged once, as theirs', () => {
    const builtins = builtinItems(builtinRows);
    const mine = coachItems([
      coachRow(),
      coachRow({ id: 'c2', exercise_id: 'b-bridge', direction: 'over', exercise: { name: 'Glute Bridge', tracking_type: 'reps', image_paths: [], source: 'builtin' } }),
    ]);
    const merged = mergeLibrary(mine, builtins);
    expect(merged.map((i) => i.key)).toEqual(['c:c1', 'c:c2', 'b:standing_calf_stretch', 'b:banded_lateral_walk']);
    expect(merged.filter((i) => i.exerciseId === 'b-bridge')).toHaveLength(1);
    expect(merged.find((i) => i.exerciseId === 'b-bridge')!.yours).toBe(true);
  });
});

describe('filterLibrary', () => {
  const items = mergeLibrary(coachItems([coachRow()]), builtinItems(builtinRows));
  it('filters by direction, yours and muscle', () => {
    expect(filterLibrary(items, { query: '', show: 'over', muscle: null }).map((i) => i.name)).toEqual(['Calf Stretch Hands Against Wall']);
    expect(filterLibrary(items, { query: '', show: 'yours', muscle: null }).map((i) => i.name)).toEqual(['DNS Star']);
    expect(filterLibrary(items, { query: '', show: 'all', muscle: 'glute_max' }).map((i) => i.name)).toEqual(['banded lateral walk', 'Glute Bridge']);
  });
  it('searches with the typo-tolerant smart search', () => {
    expect(filterLibrary(items, { query: 'latral wlk', show: 'all', muscle: null }).map((i) => i.name)).toEqual(['banded lateral walk']);
    expect(filterLibrary(items, { query: 'dns', show: 'under', muscle: null }).map((i) => i.name)).toEqual(['DNS Star']);
  });
});

describe('groupLibrary', () => {
  const items = mergeLibrary(coachItems([coachRow()]), builtinItems(builtinRows));
  it('groups by first muscle and direction: Under first, top to bottom; yours first in a group', () => {
    const groups = groupLibrary(items);
    expect(groups.map((g) => `${g.direction}.${g.muscleId}`)).toEqual(['under.glute_medius', 'under.glute_max', 'over.calves']);
    expect(groups[0]!.items.map((i) => i.name)).toEqual(['DNS Star', 'banded lateral walk']);
  });
  it('groups under the filtered muscle', () => {
    const groups = groupLibrary(filterLibrary(items, { query: '', show: 'all', muscle: 'glute_max' }), 'glute_max');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(2);
  });
  it('lists the muscles in use, top to bottom', () => {
    expect(libraryMuscles(items)).toEqual(['glute_medius', 'glute_max', 'hamstrings', 'calves']);
  });
});

describe('tags', () => {
  it('labels and toggles sides', () => {
    expect(muscleTagLabel('glute_medius', ['L', 'R'])).toBe('Glute medius · L R');
    expect(muscleTagLabel('abs', ['none'])).toBe('Abs');
    const t = toggleTag(toggleTag([], 'calves', 'R'), 'abs', 'none');
    expect(tagsByMuscle(t)).toEqual([
      { muscleId: 'abs', sides: ['none'] },
      { muscleId: 'calves', sides: ['R'] },
    ]);
    expect(toggleTag(t, 'calves', 'R')).toEqual([{ muscleId: 'abs', side: 'none' }]);
  });
});

describe('isExercisePhotoPath', () => {
  it('accepts only this workspace and exercise, a uuid file and webp or jpg', () => {
    expect(isExercisePhotoPath(`custom/${WS}/${EX}/${FILE}.webp`, WS, EX)).toBe(true);
    expect(isExercisePhotoPath(`custom/${WS}/${EX}/${FILE}.jpg`, WS, EX)).toBe(true);
    expect(isExercisePhotoPath(`custom/${WS}/${EX}/${FILE}.png`, WS, EX)).toBe(false);
    expect(isExercisePhotoPath(`custom/${EX}/${EX}/${FILE}.webp`, WS, EX)).toBe(false);
    expect(isExercisePhotoPath(`custom/${WS}/${FILE}/${FILE}.webp`, WS, EX)).toBe(false);
    expect(isExercisePhotoPath(`custom/${WS}/${EX}/../${FILE}.webp`, WS, EX)).toBe(false);
    expect(isExercisePhotoPath(`free-exercise-db/${FILE}.webp`, WS, EX)).toBe(false);
  });
});

describe('exerciseStep', () => {
  const base = { fixedId: null, source: 'new' as const, pickedId: null, made: null, name: 'DNS Star', tracking: 'reps' };
  it('uses a fixed or picked exercise', () => {
    expect(exerciseStep({ ...base, fixedId: 'f' })).toEqual({ kind: 'use', id: 'f' });
    expect(exerciseStep({ ...base, source: 'library', pickedId: 'p' })).toEqual({ kind: 'use', id: 'p' });
    expect(exerciseStep({ ...base, source: 'library' })).toEqual({ kind: 'none' });
  });
  it('creates a new exercise once, then reuses it on a retry', () => {
    expect(exerciseStep(base)).toEqual({ kind: 'create' });
    const made = { id: 'm', name: 'DNS Star', tracking: 'reps' };
    expect(exerciseStep({ ...base, made, name: '  DNS   Star ' })).toEqual({ kind: 'use', id: 'm' });
  });
  it('renames the exercise an earlier try made instead of making a second one', () => {
    const made = { id: 'm', name: 'DNS Star', tracking: 'reps' };
    expect(exerciseStep({ ...base, made, name: 'DNS Star Prone' })).toEqual({ kind: 'rename', id: 'm' });
    expect(exerciseStep({ ...base, made, tracking: 'time' })).toEqual({ kind: 'rename', id: 'm' });
  });
});
