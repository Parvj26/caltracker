// Reading docs that may name a tracking type this build doesn't know (see FALLBACK_TRACKING_TYPE). Pure.
import { parseTempo } from '../workouts/tempo';
import { FALLBACK_TRACKING_TYPE, isTrackingType } from './tracking';

export type RawObject = Record<string, unknown>;

export const isRawObject = (v: unknown): v is RawObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Applies `fn` to each object in `o[key]` when it is an array; anything else is left for the schema to judge. */
export function mapRawArray(o: RawObject, key: string, fn: (item: RawObject) => RawObject): RawObject {
  const v = o[key];
  return Array.isArray(v) ? { ...o, [key]: v.map((x: unknown) => (isRawObject(x) ? fn(x) : x)) } : o;
}

/**
 * `o` with an unknown `trackingType` replaced by the fallback, and `onUnknown` applied after (to clear what the
 * fallback doesn't track). A known type, or a non-object, comes back as it was.
 */
export function withKnownTrackingType(o: RawObject, onUnknown: (o: RawObject) => RawObject = (x) => x): RawObject {
  return isTrackingType(o.trackingType) ? o : onUnknown({ ...o, trackingType: FALLBACK_TRACKING_TYPE });
}

/**
 * `o` with Each side and Tempo this build can read: a tempo it can't (not a string, or not "3-1-1-0", say from a newer
 * server that allows more) reads as none, and an Each side that isn't true or false as off, instead of failing the
 * whole doc. Docs without either key come back as they were.
 */
export function withReadableExerciseOptions(o: RawObject): RawObject {
  let out = o;
  if ('tempo' in o && o.tempo !== null && o.tempo !== undefined) {
    const t = typeof o.tempo === 'string' ? parseTempo(o.tempo) : null;
    if (!t || !t.ok) out = { ...out, tempo: null };
  }
  if ('eachSide' in o && o.eachSide !== undefined && typeof o.eachSide !== 'boolean') out = { ...out, eachSide: false };
  return out;
}
