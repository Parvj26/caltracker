// The HealthKit calls (read only: nothing is ever written to Apple Health). The library is loaded lazily and every call
// is guarded, so a phone or iPad without HealthKit, Android, or a build without the native part simply reports
// "not available" instead of crashing.
import { Platform } from 'react-native';
import { HEALTH_TYPES, healthQueryOptions, type AppleHealthMetric, type HealthRead } from './apple-health-logic';

type HealthKitModule = typeof import('@kingstinct/react-native-healthkit');

let loaded: HealthKitModule | null | undefined;

function healthKit(): HealthKitModule | null {
  if (loaded !== undefined) return loaded;
  if (Platform.OS !== 'ios') return (loaded = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded on first use so a build or device without HealthKit never fails at start-up
    loaded = require('@kingstinct/react-native-healthkit') as HealthKitModule;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** True when this device has Apple Health (iPhone; iPad on iPadOS 17 and later). */
export function appleHealthAvailable(): boolean {
  try {
    return healthKit()?.isHealthDataAvailable() ?? false;
  } catch {
    return false;
  }
}

/**
 * Shows the iOS "allow CalTracker to read" prompt for these metrics (read only). Call it only from a tap. iOS never
 * says whether the client allowed reading, so true only means the question was asked; false or a throw means it failed.
 */
export async function askAppleHealth(metrics: readonly AppleHealthMetric[]): Promise<boolean> {
  const hk = healthKit();
  if (!hk) throw new Error('Apple Health is not available.');
  if (metrics.length === 0) return true;
  try {
    return await hk.requestAuthorization({ toRead: metrics.map((m) => HEALTH_TYPES[m].id) });
  } catch (e) {
    console.warn(`[apple health] ask: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

/**
 * New, changed and deleted samples of one metric since `anchor` (the first read goes a year back). Throws when
 * HealthKit cannot be read (e.g. the phone is locked).
 */
export async function readAppleHealth(metric: AppleHealthMetric, anchor: string | undefined, now = new Date()): Promise<HealthRead> {
  const hk = healthKit();
  if (!hk) throw new Error('Apple Health is not available.');
  const type = HEALTH_TYPES[metric];
  // The units HEALTH_TYPES names: kg, %, ml/(kg*min), count/min, cm. A year back on the first read only.
  const res = await hk.queryQuantitySamplesWithAnchor(type.id, { ...healthQueryOptions(anchor, now), unit: type.unit });
  return {
    metric,
    samples: res.samples.map((s) => ({ uuid: s.uuid, quantity: s.quantity, startDate: s.startDate })),
    deleted: res.deletedSamples.map((d) => d.uuid),
    newAnchor: res.newAnchor,
  };
}
