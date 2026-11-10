import { describe, expect, it } from 'vitest';
import {
  MEASUREMENTS,
  applyExercisePrefs,
  canPickMeasurements,
  exerciseBadges,
  measurementsLabel,
  measurementsOf,
  setColumns,
  toggleMeasurement,
  trackingTypeOf,
} from '../../src/workouts/measurements';
import { TEMPO_PLACEHOLDER, parseTempo } from '../../src/workouts/tempo';
import { LIBRARY_TRACKING_TYPES, TRACKING_TYPES, isTrackingType } from '../../src/exercises/tracking';
import { targetFieldsFor } from '../../src/workouts/targets';

describe('measurements (Weight / Reps / Time per workout exercise)', () => {
  it('lists the three choices in menu order', () => {
    expect(MEASUREMENTS).toEqual(['weight', 'reps', 'time']);
  });

  it('reads each library kind as its measurements; distance has none to pick', () => {
    expect(measurementsOf('weight_reps')).toEqual(['weight', 'reps']);
    expect(measurementsOf('reps')).toEqual(['reps']);
    expect(measurementsOf('time')).toEqual(['time']);
    expect(measurementsOf('weight_time')).toEqual(['weight', 'time']);
    expect(measurementsOf('distance')).toBeNull();
    expect(canPickMeasurements('distance')).toBe(false);
    expect(canPickMeasurements('reps')).toBe(true);
  });

  it('turns every non-empty choice into a tracking type and back', () => {
    const combos: Array<[ReturnType<typeof measurementsOf>, string]> = [
      [['weight', 'reps'], 'weight_reps'],
      [['reps'], 'reps'],
      [['time'], 'time'],
      [['weight', 'time'], 'weight_time'],
      [['weight'], 'weight'],
      [['reps', 'time'], 'reps_time'],
      [['weight', 'reps', 'time'], 'weight_reps_time'],
    ];
    for (const [ms, tt] of combos) {
      expect(trackingTypeOf(ms!)).toBe(tt);
      expect(measurementsOf(tt as never)).toEqual(ms);
    }
    // Order doesn't matter; none is no type.
    expect(trackingTypeOf(['time', 'weight'])).toBe('weight_time');
    expect(trackingTypeOf([])).toBeNull();
  });

  it('gives the new types the target columns they measure', () => {
    expect(targetFieldsFor('weight')).toEqual(['weight']);
    expect(targetFieldsFor('reps_time')).toEqual(['reps', 'duration']);
    expect(targetFieldsFor('weight_reps_time')).toEqual(['reps', 'weight', 'duration']);
  });

  it('reads a library exercise\'s kind as a library type', async () => {
    const { toLibraryTrackingType } = await import('../../src/exercises/tracking');
    expect(toLibraryTrackingType('weight_time')).toBe('weight_time');
    expect(toLibraryTrackingType('reps_time')).toBe('weight_reps');
  });

  it('knows the new types but keeps them out of the library list', () => {
    expect(isTrackingType('weight_reps_time')).toBe(true);
    expect(TRACKING_TYPES).toContain('reps_time');
    expect(LIBRARY_TRACKING_TYPES).toEqual(['weight_reps', 'reps', 'time', 'distance', 'weight_time']);
  });

  it('toggles one measurement, never leaving none, and leaves distance alone', () => {
    expect(toggleMeasurement('weight_reps', 'time')).toBe('weight_reps_time');
    expect(toggleMeasurement('weight_reps', 'reps')).toBe('weight');
    expect(toggleMeasurement('reps', 'reps')).toBe('reps');
    expect(toggleMeasurement('time', 'time')).toBe('time');
    expect(toggleMeasurement('distance', 'reps')).toBe('distance');
  });

  it('labels the pill with the active measurements joined by " · "', () => {
    expect(measurementsLabel('weight_reps')).toBe('Weight · Reps');
    expect(measurementsLabel('weight_reps_time')).toBe('Weight · Reps · Time');
    expect(measurementsLabel('time')).toBe('Time');
    expect(measurementsLabel('distance')).toBe('Distance');
  });
});

describe('setColumns', () => {
  it('lists weight, reps, time then distance, in the units shown', () => {
    expect(setColumns('weight_reps', 'lb')).toEqual([
      { field: 'weight', heading: 'LB' },
      { field: 'reps', heading: 'REPS' },
    ]);
    expect(setColumns('weight_reps_time', 'kg').map((c) => c.heading)).toEqual(['KG', 'REPS', 'TIME']);
    expect(setColumns('distance', 'lb')).toEqual([{ field: 'distance', heading: 'MI' }]);
    expect(setColumns('distance', 'kg')).toEqual([{ field: 'distance', heading: 'KM' }]);
  });

  it('says EACH on weight and reps for an each-side exercise; time is unchanged', () => {
    expect(setColumns('weight_reps_time', 'lb', { eachSide: true }).map((c) => c.heading)).toEqual([
      'LB EACH',
      'REPS EACH',
      'TIME',
    ]);
  });

  it('reads an unknown type (a newer server) as the fallback, reps', () => {
    expect(setColumns('rowing' as never, 'lb')).toEqual([{ field: 'reps', heading: 'REPS' }]);
  });
});

describe('exerciseBadges', () => {
  it('has nothing for a plain exercise', () => {
    expect(exerciseBadges({ trackingType: 'weight_reps' })).toEqual({ badges: [], help: null });
    expect(exerciseBadges({ trackingType: 'weight_reps', eachSide: false, tempo: null })).toEqual({ badges: [], help: null });
  });

  it('shows Each side and Tempo with the explanation line', () => {
    expect(exerciseBadges({ trackingType: 'weight_reps', eachSide: true, tempo: '3-1-1-0' })).toEqual({
      badges: ['Each side', 'Tempo 3-1-1-0'],
      help: 'Each side: the weight is per hand and the reps are per side. Tempo: seconds down, pause, up, pause.',
    });
  });

  it('words each side for what the exercise measures', () => {
    expect(exerciseBadges({ trackingType: 'reps', eachSide: true }).help).toBe('Each side: the reps are per side.');
    expect(exerciseBadges({ trackingType: 'time', eachSide: true }).help).toBe('Each side: the time is per side.');
    expect(exerciseBadges({ trackingType: 'weight', eachSide: true }).help).toBe('Each side: the weight is per hand.');
  });

  it('explains X in a tempo', () => {
    expect(exerciseBadges({ trackingType: 'reps', tempo: '3-0-X-0' }).help).toBe(
      'Tempo: seconds down, pause, up, pause. X means explosive.',
    );
  });

  it('ignores a tempo that is not valid', () => {
    expect(exerciseBadges({ trackingType: 'reps', tempo: 'slow' })).toEqual({ badges: [], help: null });
  });
});

describe('parseTempo', () => {
  it('has the 0-0-0-0 placeholder', () => {
    expect(TEMPO_PLACEHOLDER).toBe('0-0-0-0');
  });

  it('reads blank as no tempo', () => {
    expect(parseTempo('')).toEqual({ ok: true, tempo: null });
    expect(parseTempo('   ')).toEqual({ ok: true, tempo: null });
    expect(parseTempo(null)).toEqual({ ok: true, tempo: null });
    expect(parseTempo(undefined)).toEqual({ ok: true, tempo: null });
  });

  it('normalises spaces, a lowercase x and typographic dashes', () => {
    expect(parseTempo('3-1-1-0')).toEqual({ ok: true, tempo: '3-1-1-0' });
    expect(parseTempo(' 3 - 1 - x - 0 ')).toEqual({ ok: true, tempo: '3-1-X-0' });
    expect(parseTempo('4–0–1—0')).toEqual({ ok: true, tempo: '4-0-1-0' });
  });

  it('refuses anything but four parts of 0-9 or X', () => {
    for (const bad of ['3-1-1', '3-1-1-0-0', '31-1-1-0', '3-1-a-0', '3110', '3--1-0', '-3-1-1']) {
      const r = parseTempo(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.message).toBe('Tempo is four parts like 3-1-1-0, each 0–9 or X (explosive).');
    }
  });
});

describe('applyExercisePrefs (the coach’s last choice for an exercise)', () => {
  const pick = { id: 'a', name: 'Lunge', trackingType: 'weight_reps' as const };

  it('leaves a pick with no remembered choice as it is', () => {
    expect(applyExercisePrefs(pick, undefined)).toEqual(pick);
  });

  it('uses the remembered measurements and each side', () => {
    expect(applyExercisePrefs(pick, { trackingType: 'weight_reps_time', eachSide: true })).toEqual({
      ...pick,
      trackingType: 'weight_reps_time',
      eachSide: true,
    });
  });

  it('keeps the library kind when nothing was overridden', () => {
    expect(applyExercisePrefs(pick, { trackingType: null, eachSide: true })).toEqual({ ...pick, eachSide: true });
  });

  it('never overrides a distance exercise or uses distance / an unknown type as a choice', () => {
    const run = { id: 'b', name: 'Run', trackingType: 'distance' as const };
    expect(applyExercisePrefs(run, { trackingType: 'time', eachSide: false })).toEqual({ ...run, eachSide: false });
    expect(applyExercisePrefs(pick, { trackingType: 'distance', eachSide: false }).trackingType).toBe('weight_reps');
    expect(applyExercisePrefs(pick, { trackingType: 'rowing' as never, eachSide: false }).trackingType).toBe('weight_reps');
  });
});

describe('weight × reps counting for the new measurements', () => {
  it('counts weight, reps and time for volume and PRs; weight only or reps and time do not', async () => {
    const { mkLog } = await import('../awards/helpers');
    const { logVolumeKg } = await import('../../src/logs/summary');
    const { liftsByExercise } = await import('../../src/awards/prs');
    const { countsWeightTimesReps } = await import('../../src/workouts/targets');
    expect(countsWeightTimesReps('weight_reps')).toBe(true);
    expect(countsWeightTimesReps('weight_reps_time')).toBe(true);
    expect(countsWeightTimesReps('weight')).toBe(false);
    expect(countsWeightTimesReps('reps_time')).toBe(false);
    const all3 = mkLog([{ trackingType: 'weight_reps_time', sets: [{ w: 50, r: 10 }] }]);
    expect(logVolumeKg(all3)).toBe(500);
    expect(liftsByExercise(all3).size).toBe(1);
    const weightOnly = mkLog([{ trackingType: 'weight', sets: [{ w: 50, r: 10 }] }]);
    expect(logVolumeKg(weightOnly)).toBe(0);
    expect(liftsByExercise(weightOnly).size).toBe(0);
  });
});
