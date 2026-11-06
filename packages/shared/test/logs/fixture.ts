import { addChoice, addSection, addStraightBlock, emptyWorkout } from '../../src/workouts/doc-ops';
import type { ExercisePick } from '../../src/workouts/doc-ops';
import { WorkoutDoc } from '../../src/workouts/schema';
import type { SetType } from '../../src/workouts/schema';

let counter = 0;
export const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

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

const exercise = (sets: unknown[]) => ({
  id: uuid(),
  exerciseId: uuid(),
  exerciseName: 'Bench press',
  trackingType: 'weight_reps',
  note: null,
  sets,
});

/** Straight block (W + 3 normal 8-10 @ 60 kg + drop to failure) plus a 2-exercise x 3-round superset. */
export function fixtureWorkout(): WorkoutDoc {
  const drop = set('drop', { targetRepsMin: null, targetRepsMax: null, targetWeightKg: 40, toFailure: true });
  const straight = { id: uuid(), kind: 'straight', exercises: [exercise([set('warmup'), set(), set(), set(), drop])] };
  const ss = { id: uuid(), kind: 'superset', exercises: [exercise([set(), set(), set()]), exercise([set(), set(), set()])] };
  return WorkoutDoc.parse({ id: uuid(), name: 'Upper A', notes: null, blocks: [straight, ss] });
}

const pickEx = (): ExercisePick => ({ id: uuid(), name: 'Exercise', trackingType: 'weight_reps' });

/** Warm-Up [1], Resistance Training [straight, pick-one of 2, straight], Core [1], Finisher [1]: 6 blocks. */
export function fixtureSectionedWorkout(): WorkoutDoc {
  let d = emptyWorkout(uuid, 'Upper / Core');
  d = addSection(d, 'Warm-Up', uuid);
  d = addStraightBlock(d, pickEx(), uuid);
  d = addSection(d, 'Resistance Training', uuid);
  d = addStraightBlock(d, pickEx(), uuid);
  d = addChoice(d, [pickEx(), pickEx()], uuid);
  d = addStraightBlock(d, pickEx(), uuid);
  d = addSection(d, 'Core', uuid);
  d = addStraightBlock(d, pickEx(), uuid);
  d = addSection(d, 'Finisher', uuid);
  d = addStraightBlock(d, pickEx(), uuid);
  return WorkoutDoc.parse(d);
}
