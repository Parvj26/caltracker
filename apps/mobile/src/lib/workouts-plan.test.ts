import { describe, expect, it } from 'vitest';
import type { WorkoutBlockDoc, WorkoutDoc, WorkoutExerciseDoc, WorkoutSetDoc } from '@caltracker/shared';
import type { ExerciseDetail } from './exercise-detail';
import {
  coachFirstName,
  exercisePlanLine,
  firstSelectedDay,
  lastTimeLine,
  muscleTags,
  planMeta,
  planTotals,
  previewSubtitle,
  programDayOf,
  selectedHeading,
  weekStrip,
  weekTitle,
} from './workouts-plan';

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const set = (over: Partial<WorkoutSetDoc> = {}): WorkoutSetDoc => ({
  id: uid(),
  setType: 'normal',
  targetRepsMin: 6,
  targetRepsMax: 8,
  targetWeightKg: 84,
  targetDurationS: null,
  targetDistanceM: null,
  toFailure: false,
  restSeconds: 90,
  note: null,
  ...over,
});

const ex = (sets: WorkoutSetDoc[], over: Partial<WorkoutExerciseDoc> = {}): WorkoutExerciseDoc => ({
  id: uid(),
  exerciseId: uid(),
  exerciseName: 'Back Squat',
  trackingType: 'weight_reps',
  note: null,
  sets,
  substitutes: [],
  ...over,
});

const block = (kind: WorkoutBlockDoc['kind'], exercises: WorkoutExerciseDoc[]): WorkoutBlockDoc => ({
  id: uid(),
  sectionId: null,
  kind,
  exercises,
});

const doc = (blocks: WorkoutBlockDoc[]): WorkoutDoc =>
  ({ id: uid(), name: 'Upper A', notes: null, sections: [], blocks }) as unknown as WorkoutDoc;

describe('programDayOf', () => {
  it('counts weeks and days from the assignment start', () => {
    expect(programDayOf('2026-11-02', '2026-11-02')).toEqual({ week: 1, day: 1 });
    expect(programDayOf('2026-11-02', '2026-11-09')).toEqual({ week: 2, day: 1 });
    expect(programDayOf('2026-11-02', '2026-11-11')).toEqual({ week: 2, day: 3 });
  });

  it('is null without a program or before it starts', () => {
    expect(programDayOf(null, '2026-11-09')).toBeNull();
    expect(programDayOf('2026-11-02', null)).toBeNull();
    expect(programDayOf('2026-11-09', '2026-11-02')).toBeNull();
  });
});

describe('planTotals', () => {
  it('counts exercises and sets, a drop not counted as a set', () => {
    const d = doc([block('straight', [ex([set(), set(), set({ setType: 'drop', restSeconds: 0 })])]), block('straight', [ex([set()])])]);
    const t = planTotals(d);
    expect(t.exercises).toBe(2);
    expect(t.sets).toBe(3);
  });

  it('counts a pick-one group as one exercise with its first option’s sets', () => {
    const d = doc([block('choice', [ex([set(), set()]), ex([set(), set(), set(), set()])])]);
    expect(planTotals(d)).toMatchObject({ exercises: 1, sets: 2 });
  });

  it('estimates minutes: 40 s per set (or its target time), its rest, and a minute per exercise, to the nearest 5', () => {
    // 4 sets × (40 + 120) s + 60 s = 700 s ≈ 11.7 min → 10.
    expect(planTotals(doc([block('straight', [ex([set({ restSeconds: 120 }), set({ restSeconds: 120 }), set({ restSeconds: 120 }), set({ restSeconds: 120 })])])])).minutes).toBe(10);
    // A timed set uses its target: 3 × (300 + 60) + 60 = 1140 s = 19 min → 20.
    const timed = ex([1, 2, 3].map(() => set({ targetRepsMin: null, targetRepsMax: null, targetWeightKg: null, targetDurationS: 300, restSeconds: 60 })), {
      trackingType: 'duration',
    });
    expect(planTotals(doc([block('straight', [timed])])).minutes).toBe(20);
  });

  it('never says less than 5 minutes', () => {
    expect(planTotals(doc([block('straight', [ex([set({ restSeconds: 0 })])])])).minutes).toBe(5);
  });
});

describe('planMeta', () => {
  it('words the card line and the coming-up line', () => {
    expect(planMeta({ exercises: 6, sets: 18, minutes: 50 }, true)).toBe('6 exercises · 18 sets · about 50 min');
    expect(planMeta({ exercises: 1, sets: 1, minutes: 5 }, false)).toBe('1 exercise · about 5 min');
  });
});

const detail = (id: string, primaryMuscles: string[]): ExerciseDetail => ({
  id,
  name: id,
  imagePaths: [],
  primaryMuscles,
  secondaryMuscles: [],
  equipment: null,
  instructions: [],
  videoUrl: null,
});

describe('muscleTags', () => {
  it('lists the chips of every exercise’s primary muscles once, in picker order', () => {
    const details = { a: detail('a', ['triceps']), b: detail('b', ['chest']), c: detail('c', ['biceps', 'lats']) };
    expect(muscleTags(['a', 'b', 'c', 'missing'], details)).toEqual(['Chest', 'Back', 'Arms']);
  });
});

describe('weekStrip', () => {
  const workouts = [
    { id: 'w1', scheduledOn: '2026-11-09' },
    { id: 'w2', scheduledOn: '2026-11-11' },
  ];

  it('marks today, workout days, done days and the selected day', () => {
    const days = weekStrip('2026-11-09', '2026-11-10', '2026-11-11', workouts, { w1: { kind: 'done', logId: 'l', durationS: 60 } });
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ date: '2026-11-09', dow: 'Mon', num: 9, hasWorkout: true, done: true, isToday: false });
    expect(days[1]).toMatchObject({ isToday: true, hasWorkout: false, done: false });
    expect(days[2]).toMatchObject({ selected: true, hasWorkout: true, done: false });
    expect(days[0]?.label).toBe('Mon 9 Nov, workout, done');
    expect(days[1]?.label).toBe('Tue 10 Nov, rest day, today');
  });

  it('is done only when every workout that day is done', () => {
    const two = [...workouts, { id: 'w3', scheduledOn: '2026-11-09' }];
    const days = weekStrip('2026-11-09', '2026-11-10', null, two, { w1: { kind: 'done', logId: 'l', durationS: 60 } });
    expect(days[0]?.done).toBe(false);
  });
});

describe('firstSelectedDay', () => {
  it('picks today in this week, else the first workout day, else Monday', () => {
    expect(firstSelectedDay('2026-11-09', '2026-11-12', [])).toBe('2026-11-12');
    expect(firstSelectedDay('2026-11-16', '2026-11-12', [{ id: 'x', scheduledOn: '2026-11-18' }])).toBe('2026-11-18');
    expect(firstSelectedDay('2026-11-16', '2026-11-12', [])).toBe('2026-11-16');
  });
});

describe('weekTitle', () => {
  it('names this, last and next week, with the date range', () => {
    expect(weekTitle('2026-11-09', '2026-11-11')).toBe('This week · Nov 9–15');
    expect(weekTitle('2026-11-02', '2026-11-11')).toBe('Last week · Nov 2–8');
    expect(weekTitle('2026-11-30', '2026-11-25')).toBe('Next week · Nov 30 – Dec 6');
    expect(weekTitle('2026-12-14', '2026-11-11')).toBe('Dec 14–20');
  });
});

describe('selectedHeading', () => {
  it('says Today for today', () => {
    expect(selectedHeading('2026-11-09', '2026-11-09')).toBe('Today · Mon 9');
    expect(selectedHeading('2026-11-11', '2026-11-09')).toBe('Wed 11 Nov');
  });
});

describe('previewSubtitle', () => {
  it('joins date, program and week/day, skipping what is missing', () => {
    expect(previewSubtitle('2026-11-11', 'Strength Block', { week: 2, day: 2 })).toBe('Wed 11 Nov · Strength Block · Week 2 · Day 2');
    expect(previewSubtitle('2026-11-11', null, null)).toBe('Wed 11 Nov');
  });
});

describe('exercisePlanLine', () => {
  it('says "N × target" when the working sets share one target', () => {
    const e = ex([set({ setType: 'warmup', targetWeightKg: 40 }), set(), set(), set()]);
    expect(exercisePlanLine(e, 'kg')).toBe('3 × 6–8 reps · 84 kg');
  });

  it('lists each set when they differ', () => {
    const e = ex([set({ targetWeightKg: 80 }), set({ targetWeightKg: 84 })]);
    expect(exercisePlanLine(e, 'kg')).toBe('80 kg × 6–8, 84 kg × 6–8');
  });
});

describe('lastTimeLine', () => {
  const e = ex([set()]);
  it('shows the last result, "New exercise" with no history, and nothing when unknown', () => {
    const last = {
      [e.exerciseId]: {
        finishedAt: '2026-11-02T10:00:00Z',
        sets: [{ setType: 'normal' as const, actualReps: 8, actualWeightKg: 80, actualDurationS: null, actualDistanceM: null }],
      },
    };
    expect(lastTimeLine(e, last, 'kg')).toBe('Last time: 80 kg × 8');
    expect(lastTimeLine(e, {}, 'kg')).toBe('New exercise');
    expect(lastTimeLine(e, null, 'kg')).toBeNull();
  });
});

describe('coachFirstName', () => {
  it('takes the first word', () => {
    expect(coachFirstName('  Luis  Moreno ')).toBe('Luis');
    expect(coachFirstName('')).toBeNull();
    expect(coachFirstName(null)).toBeNull();
  });
});
