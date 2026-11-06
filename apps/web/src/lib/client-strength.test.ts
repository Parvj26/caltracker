import { describe, expect, it } from 'vitest';
import type { WorkoutLogDoc } from '@caltracker/shared';
import { buildStrength } from './client-strength';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SQUAT = id(9);
const log = (finishedAt: string): WorkoutLogDoc => ({
  id: id(1), workoutId: null, name: 'Legs', status: 'completed', startedAt: finishedAt, finishedAt, lastActivityAt: finishedAt,
  autoFinished: false, revision: 0, notes: null, sections: [],
  blocks: [{ id: id(2), sectionId: null, pickedExerciseId: null, kind: 'straight', exercises: [{
    id: id(3), exerciseId: SQUAT, exerciseName: 'Squat', trackingType: 'weight_reps', plannedWorkoutExerciseId: null, swappedFromExerciseId: null, note: null,
    sets: [{ id: id(4), setType: 'normal', target: { repsMin: null, repsMax: null, weightKg: null, durationS: null, distanceM: null, toFailure: false, restSeconds: null }, actualReps: 5, actualWeightKg: 100, actualDurationS: null, actualDistanceM: null, completedAt: finishedAt }],
  }] }],
});

describe('buildStrength', () => {
  it('puts a 23:30 local workout on the client\'s own day, not the UTC one', () => {
    // 23:30 on 20 Oct in New York (UTC-4) is 03:30 UTC on 21 Oct.
    const logs = [log('2026-10-21T03:30:00.000Z')];
    expect(buildStrength(logs, 'America/New_York')[0]?.points[0]?.date).toBe('2026-10-20');
    expect(buildStrength(logs, 'UTC')[0]?.points[0]?.date).toBe('2026-10-21');
  });
});
