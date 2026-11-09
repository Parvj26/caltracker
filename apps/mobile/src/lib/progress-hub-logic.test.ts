import { describe, expect, it } from 'vitest';
import { keysToForget } from './device-cache-keys';
import {
  addedDays,
  buildHub,
  hubCacheKey,
  lastExerciseKey,
  parseFoodRangeCache,
  parseHubCache,
  prKeys,
  type HubData,
} from './progress-hub-logic';

const log = (id: string, finishedAt: string, workoutId: string | null, planned: boolean, exerciseId = 'sq') => ({
  id,
  workoutId,
  name: 'W',
  status: 'completed' as const,
  startedAt: finishedAt,
  finishedAt,
  lastActivityAt: finishedAt,
  autoFinished: false,
  revision: 0,
  notes: null,
  sections: [],
  blocks: [
    {
      id: `b${id}`,
      sectionId: null,
      pickedExerciseId: null,
      kind: 'straight' as const,
      exercises: [
        {
          id: `e${id}`,
          exerciseId,
          exerciseName: 'Squat',
          trackingType: 'weight_reps' as const,
          plannedWorkoutExerciseId: planned ? 'pwe' : null,
          swappedFromExerciseId: null,
          note: null,
          substituteId: null,
          substituteOptions: [],
          sets: [
            {
              id: `s${id}`,
              setType: 'normal' as const,
              target: { repsMin: null, repsMax: null, weightKg: null, durationS: null, distanceM: null, toFailure: false, restSeconds: null },
              actualReps: 5,
              actualWeightKg: 100,
              actualDurationS: null,
              actualDistanceM: null,
              completedAt: finishedAt,
            },
          ],
        },
      ],
    },
  ],
});

const hub = (): HubData =>
  buildHub({
    logs: [log('l1', '2026-11-02T10:00:00.000Z', 'w1', true), log('l2', '2026-11-04T10:00:00.000Z', null, false)],
    muscles: { sq: 'quadriceps' },
    workouts: [],
    assignments: [],
    records: [],
    awardPrs: [{ logId: 'l2', prs: [{ logId: 'l2', exerciseId: 'sq', achievedAt: '2026-11-04T10:00:00Z' }] }],
    userId: 'u1',
    timeZone: 'UTC',
  });

describe('buildHub', () => {
  it('keeps each exercise’s series, muscle and recent sessions, and which workouts were added', () => {
    const h = hub();
    expect(h.exercises).toHaveLength(1);
    expect(h.exercises[0]).toMatchObject({ exerciseId: 'sq', name: 'Squat', muscle: 'quadriceps' });
    expect(h.exercises[0].points.map((p) => p.date)).toEqual(['2026-11-02', '2026-11-04']);
    expect(h.exercises[0].sessions.map((s) => s.logId)).toEqual(['l2', 'l1']);
    expect(addedDays(h)).toEqual(['2026-11-04']);
    expect(h.finished.map((f) => f.day)).toEqual(['2026-11-02', '2026-11-04']);
    expect([...prKeys(h)]).toEqual(['l2|sq']);
  });
});

describe('the saved copies', () => {
  it('reads back the hub and ignores junk or another version', () => {
    const h = hub();
    expect(parseHubCache(JSON.stringify(h))).toEqual(h);
    expect(parseHubCache(null)).toBeNull();
    expect(parseHubCache('nope')).toBeNull();
    expect(parseHubCache(JSON.stringify({ ...h, version: 0 }))).toBeNull();
    expect(parseHubCache(JSON.stringify({ ...h, exercises: 'x' }))).toBeNull();
  });
  it('reads back the food range', () => {
    const f = { meals: [{ eatenOn: '2026-11-02', hasPhoto: false, macros: { calories: 1, protein: null, carbs: null, fat: null } }], targets: null };
    expect(parseFoodRangeCache(JSON.stringify(f))).toEqual(f);
    expect(parseFoodRangeCache(JSON.stringify({ meals: 3 }))).toBeNull();
  });
  it('is forgotten on sign out, with the remembered exercise', () => {
    expect(keysToForget([hubCacheKey('u1', 'w1'), lastExerciseKey('u1'), hubCacheKey('u2', 'w1')], 'u1')).toEqual([
      hubCacheKey('u1', 'w1'),
      lastExerciseKey('u1'),
    ]);
  });
});
