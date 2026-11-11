// What a workout exercise measures (Weight / Reps / Time), its set columns, and the Each side / Tempo badges. Pure.
//
// A workout exercise's measurements are stored as a tracking type: the library exercise's own kind unless the coach
// picked others for this workout (workout_exercises.tracking_type). Every non-empty pick of the three is one type,
// so everything that reads a tracking type (validation, logging, formatting) follows the pick with no other change.
// Distance exercises keep their kind: distance can't be picked, and their measurements can't be changed.
import { FALLBACK_TRACKING_TYPE, isTrackingType, toTrackingType } from '../exercises/tracking';
import type { TrackingType } from '../exercises/tracking';
import { distanceUnitFor } from '../units/units';
import type { Units } from '../units/units';
import { targetFieldsFor } from './targets';
import { validTempo } from './tempo';

export const MEASUREMENTS = ['weight', 'reps', 'time'] as const;
export type Measurement = (typeof MEASUREMENTS)[number];

export const MEASUREMENT_NAMES: Record<Measurement, string> = { weight: 'Weight', reps: 'Reps', time: 'Time' };

const BY_TYPE: Partial<Record<TrackingType, readonly Measurement[]>> = {
  weight_reps: ['weight', 'reps'],
  reps: ['reps'],
  time: ['time'],
  weight_time: ['weight', 'time'],
  weight: ['weight'],
  reps_time: ['reps', 'time'],
  weight_reps_time: ['weight', 'reps', 'time'],
};

/** The measurements a type stands for, in menu order; null for distance (nothing to pick). */
export function measurementsOf(trackingType: TrackingType): readonly Measurement[] | null {
  return BY_TYPE[trackingType] ?? null;
}

export function canPickMeasurements(trackingType: TrackingType): boolean {
  return measurementsOf(trackingType) !== null;
}

/** The type for a pick (any order); null for an empty one. */
export function trackingTypeOf(ms: readonly Measurement[]): TrackingType | null {
  const want = MEASUREMENTS.filter((m) => ms.includes(m));
  for (const [tt, have] of Object.entries(BY_TYPE) as Array<[TrackingType, readonly Measurement[]]>) {
    if (have.length === want.length && have.every((m, i) => m === want[i])) return tt;
  }
  return null;
}

/** One checkbox in the menu: the type with `m` turned on or off. Unticking the last one changes nothing. */
export function toggleMeasurement(trackingType: TrackingType, m: Measurement): TrackingType {
  const ms = measurementsOf(trackingType);
  if (!ms) return trackingType;
  const next = ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m];
  return trackingTypeOf(next) ?? trackingType;
}

/** "Weight · Reps": the pill's text. Distance reads "Distance". */
export function measurementsLabel(trackingType: TrackingType): string {
  const ms = measurementsOf(trackingType);
  if (!ms) return trackingType === 'distance' ? 'Distance' : MEASUREMENT_NAMES.reps;
  return ms.map((m) => MEASUREMENT_NAMES[m]).join(' · ');
}

export type SetColumnField = 'weight' | 'reps' | 'duration' | 'distance';
export type SetColumn = { field: SetColumnField; heading: string };

const COLUMN_ORDER: readonly SetColumnField[] = ['weight', 'reps', 'duration', 'distance'];

/**
 * A set table's value columns, weight first ("LB | REPS | TIME"). For an each-side exercise weight and reps say
 * EACH ("LB EACH"); time is unchanged. An unknown type (a newer server's) reads as the fallback.
 */
export function setColumns(trackingType: TrackingType, units: Units, opts: { eachSide?: boolean } = {}): SetColumn[] {
  const known = isTrackingType(trackingType) ? trackingType : FALLBACK_TRACKING_TYPE;
  const fields = targetFieldsFor(known);
  const each = opts.eachSide === true ? ' EACH' : '';
  return COLUMN_ORDER.filter((f) => fields.includes(f)).map((field) => {
    switch (field) {
      case 'weight':
        return { field, heading: `${units.toUpperCase()}${each}` };
      case 'reps':
        return { field, heading: `REPS${each}` };
      case 'duration':
        return { field, heading: 'TIME' };
      case 'distance':
        return { field, heading: distanceUnitFor(units).toUpperCase() };
    }
  });
}

type BadgeSource = { trackingType: TrackingType; eachSide?: boolean | undefined; tempo?: string | null | undefined };

function eachSideHelp(trackingType: TrackingType): string {
  const fields = targetFieldsFor(isTrackingType(trackingType) ? trackingType : FALLBACK_TRACKING_TYPE);
  const parts: string[] = [];
  if (fields.includes('weight')) parts.push('the weight is per hand');
  if (fields.includes('reps')) parts.push('the reps are per side');
  if (parts.length === 0) parts.push('the time is per side');
  return `Each side: ${parts.join(' and ')}.`;
}

/**
 * The client's badges for an exercise ("Each side", "Tempo 3-1-1-0") and the one line explaining them, or no badges
 * and null. A tempo that isn't valid is left out.
 */
export function exerciseBadges(ex: BadgeSource): { badges: string[]; help: string | null } {
  const tempo = validTempo(ex.tempo);
  const badges: string[] = [];
  const help: string[] = [];
  if (ex.eachSide === true) {
    badges.push('Each side');
    help.push(eachSideHelp(ex.trackingType));
  }
  if (tempo !== null) {
    badges.push(`Tempo ${tempo}`);
    help.push(`Tempo: seconds down, pause, up, pause.${tempo.includes('X') ? ' X means explosive.' : ''}`);
  }
  return { badges, help: help.length > 0 ? help.join(' ') : null };
}

/**
 * What a workout or log exercise measures: its own pick (`override`, the row's tracking_type) or else the library
 * kind. A distance exercise always keeps its kind, whatever the row says; an unknown pick reads as the library kind.
 */
export function effectiveTrackingType(override: unknown, library: unknown): TrackingType {
  const lib = toTrackingType(library ?? 'weight_reps');
  // An override this build doesn't know (a newer server's) reads as the library kind, the closest it can show.
  if (lib === 'distance' || !isTrackingType(override)) return lib;
  return override;
}

/** The workspace's last choice for an exercise (exercise_prefs): null trackingType means the library kind. */
export type ExercisePrefs = { trackingType: TrackingType | null; eachSide: boolean };

/**
 * A picked exercise with the coach's last choice for it applied: its measurements (never for a distance exercise,
 * and only a pickable type) and Each side.
 */
export function applyExercisePrefs<P extends { trackingType: TrackingType; eachSide?: boolean }>(
  pick: P,
  prefs: ExercisePrefs | undefined,
): P {
  if (!prefs) return pick;
  const override =
    prefs.trackingType !== null && canPickMeasurements(pick.trackingType) && isTrackingType(prefs.trackingType) && canPickMeasurements(prefs.trackingType)
      ? prefs.trackingType
      : pick.trackingType;
  return { ...pick, trackingType: override, eachSide: prefs.eachSide };
}
