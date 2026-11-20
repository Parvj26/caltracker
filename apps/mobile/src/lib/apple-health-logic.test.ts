import { describe, expect, it } from 'vitest';
import {
  APPLE_HEALTH_METRICS,
  HEALTH_TYPES,
  addRead,
  appleHealthStatus,
  connect,
  defaultAppleHealthState,
  disconnect,
  firstSyncStart,
  markSent,
  metricsToAsk,
  metricsToRead,
  parseAppleHealthState,
  setMetric,
  shouldAutoSync,
  toAppleHealthSample,
} from './apple-health-logic';
import { appleHealthBatches } from './metrics-logic';

const NOW = new Date('2026-11-19T12:00:00Z');
const at = '2026-11-18T07:30:00Z';

describe('HealthKit samples to metrics', () => {
  it('asks HealthKit for kg, %, mL/kg/min, bpm and cm', () => {
    expect(HEALTH_TYPES.weight_kg).toMatchObject({ id: 'HKQuantityTypeIdentifierBodyMass', unit: 'kg' });
    expect(HEALTH_TYPES.body_fat_pct).toMatchObject({ id: 'HKQuantityTypeIdentifierBodyFatPercentage', unit: '%' });
    expect(HEALTH_TYPES.vo2_max).toMatchObject({ id: 'HKQuantityTypeIdentifierVO2Max', unit: 'ml/(kg*min)' });
    expect(HEALTH_TYPES.resting_hr_bpm).toMatchObject({ id: 'HKQuantityTypeIdentifierRestingHeartRate', unit: 'count/min' });
    expect(HEALTH_TYPES.waist_cm).toMatchObject({ id: 'HKQuantityTypeIdentifierWaistCircumference', unit: 'cm' });
  });

  it('has no muscle mass (InBody scans only)', () => {
    expect(APPLE_HEALTH_METRICS).not.toContain('smm_kg');
  });

  it('keeps kg, mL/kg/min, bpm and cm as they come', () => {
    expect(toAppleHealthSample('weight_kg', { uuid: 'a', quantity: 72.4, startDate: at }, 'UTC')).toEqual({
      externalId: 'a', metricKey: 'weight_kg', value: 72.4, measuredOn: '2026-11-18', measuredAt: at.replace('Z', '.000Z'),
    });
    expect(toAppleHealthSample('vo2_max', { uuid: 'b', quantity: 42.5, startDate: at }, 'UTC')?.value).toBe(42.5);
    expect(toAppleHealthSample('resting_hr_bpm', { uuid: 'c', quantity: 58, startDate: at }, 'UTC')?.value).toBe(58);
    expect(toAppleHealthSample('waist_cm', { uuid: 'd', quantity: 81.3, startDate: new Date(at) }, 'UTC')?.value).toBe(81.3);
  });

  it('turns HealthKit’s body fat fraction into a percent, without float noise', () => {
    expect(toAppleHealthSample('body_fat_pct', { uuid: 'e', quantity: 0.2215, startDate: at }, 'UTC')?.value).toBe(22.15);
  });

  it('dates a reading on the phone’s own calendar', () => {
    // 07:30 UTC is still the evening before in Los Angeles.
    expect(toAppleHealthSample('weight_kg', { uuid: 'f', quantity: 70, startDate: at }, 'America/Los_Angeles')?.measuredOn).toBe('2026-11-17');
    expect(toAppleHealthSample('weight_kg', { uuid: 'f', quantity: 70, startDate: at }, 'Asia/Tokyo')?.measuredOn).toBe('2026-11-18');
  });

  it('a local-dated reading passes the database checks', () => {
    const s = toAppleHealthSample('weight_kg', { uuid: 'g', quantity: 70, startDate: '2026-11-18T23:30:00Z' }, 'Pacific/Kiritimati')!;
    expect(s.measuredOn).toBe('2026-11-19');
    expect(appleHealthBatches([s], NOW).flat()).toHaveLength(1);
  });

  it('skips samples it cannot read', () => {
    expect(toAppleHealthSample('weight_kg', { uuid: '', quantity: 70, startDate: at })).toBe(null);
    expect(toAppleHealthSample('weight_kg', { uuid: 'h', quantity: NaN, startDate: at })).toBe(null);
    expect(toAppleHealthSample('weight_kg', { uuid: 'h', quantity: 70, startDate: 'soon' })).toBe(null);
  });
});

describe('switches', () => {
  it('starts off, with every metric switched on but none asked yet', () => {
    const s = defaultAppleHealthState();
    expect(s.enabled).toBe(false);
    expect(metricsToRead(s)).toEqual([]);
    expect(metricsToAsk(s)).toEqual([...APPLE_HEALTH_METRICS]);
  });

  it('reads only what is switched on and was asked about', () => {
    const types = { ...defaultAppleHealthState().types, waist_cm: false };
    const s = connect(defaultAppleHealthState(), types, ['weight_kg', 'body_fat_pct', 'vo2_max', 'resting_hr_bpm']);
    expect(metricsToRead(s)).toEqual(['weight_kg', 'body_fat_pct', 'vo2_max', 'resting_hr_bpm']);
    expect(metricsToAsk(s)).toEqual([]);
  });

  it('a metric switched on later must be asked about before it is read', () => {
    let s = connect(defaultAppleHealthState(), { ...defaultAppleHealthState().types, waist_cm: false }, ['weight_kg']);
    s = setMetric(s, 'waist_cm', true);
    expect(metricsToAsk(s)).toContain('waist_cm');
    expect(metricsToRead(s)).not.toContain('waist_cm');
    s = setMetric(s, 'waist_cm', true, true);
    expect(metricsToRead(s)).toContain('waist_cm');
  });

  it('switching a metric off forgets its marker and waiting readings', () => {
    let s = connect(defaultAppleHealthState(), defaultAppleHealthState().types, APPLE_HEALTH_METRICS);
    s = addRead(s, { metric: 'weight_kg', samples: [{ uuid: 'w', quantity: 70, startDate: at }], deleted: [], newAnchor: 'A1' });
    s = setMetric(s, 'weight_kg', false);
    expect(s.anchors.weight_kg).toBeUndefined();
    expect(s.pending).toEqual([]);
    expect(metricsToRead(s)).not.toContain('weight_kg');
  });

  it('turning off stops all syncing but remembers what iOS was asked', () => {
    let s = connect(defaultAppleHealthState(), defaultAppleHealthState().types, ['weight_kg']);
    s = addRead(s, { metric: 'weight_kg', samples: [{ uuid: 'w', quantity: 70, startDate: at }], deleted: [], newAnchor: 'A1' });
    s = disconnect(s);
    expect(s.enabled).toBe(false);
    expect(s.anchors).toEqual({});
    expect(s.pending).toEqual([]);
    expect(s.asked).toEqual(['weight_kg']);
    expect(shouldAutoSync(s, NOW, null)).toBe(false);
  });
});

describe('anchors and the waiting queue', () => {
  const on = () => connect(defaultAppleHealthState(), defaultAppleHealthState().types, APPLE_HEALTH_METRICS);

  it('moves the marker on and queues the readings', () => {
    const s = addRead(on(), { metric: 'weight_kg', samples: [{ uuid: 'w1', quantity: 70, startDate: at }], deleted: [], newAnchor: 'A1' });
    expect(s.anchors.weight_kg).toBe('A1');
    expect(s.pending.map((p) => p.externalId)).toEqual(['w1']);
    expect(s.sawData).toBe(true);
  });

  it('keeps an old marker when HealthKit gives none', () => {
    let s = addRead(on(), { metric: 'weight_kg', samples: [], deleted: [], newAnchor: 'A1' });
    s = addRead(s, { metric: 'weight_kg', samples: [], deleted: [], newAnchor: '' });
    expect(s.anchors.weight_kg).toBe('A1');
    expect(s.sawData).toBe(false);
  });

  it('a changed sample replaces its waiting copy; a deleted one is dropped and queued for removal', () => {
    let s = addRead(on(), { metric: 'weight_kg', samples: [{ uuid: 'w1', quantity: 70, startDate: at }, { uuid: 'w2', quantity: 71, startDate: at }], deleted: [], newAnchor: 'A1' });
    s = addRead(s, { metric: 'weight_kg', samples: [{ uuid: 'w1', quantity: 69, startDate: at }], deleted: ['w2', 'old'], newAnchor: 'A2' });
    expect(s.pending.map((p) => [p.externalId, p.value])).toEqual([['w1', 69]]);
    expect(s.pendingDeletes).toEqual(['w2', 'old']);
  });

  it('ignores reads for a metric switched off meanwhile', () => {
    const s0 = setMetric(on(), 'vo2_max', false);
    const s = addRead(s0, { metric: 'vo2_max', samples: [{ uuid: 'v', quantity: 40, startDate: at }], deleted: [], newAnchor: 'A' });
    expect(s).toBe(s0);
  });

  it('clears the queue once sent', () => {
    let s = addRead(on(), { metric: 'weight_kg', samples: [{ uuid: 'w1', quantity: 70, startDate: at }], deleted: ['x'], newAnchor: 'A1' });
    s = markSent(s, NOW);
    expect(s.pending).toEqual([]);
    expect(s.pendingDeletes).toEqual([]);
    expect(s.lastSyncAt).toBe(NOW.toISOString());
    expect(s.anchors.weight_kg).toBe('A1');
  });

  it('first sync reads a year back', () => {
    expect(firstSyncStart(NOW).toISOString()).toBe('2025-11-19T12:00:00.000Z');
  });
});

describe('saved state', () => {
  it('reads back what it saved', () => {
    let s = connect(defaultAppleHealthState(), { ...defaultAppleHealthState().types, waist_cm: false }, ['weight_kg']);
    s = addRead(s, { metric: 'weight_kg', samples: [{ uuid: 'w1', quantity: 70, startDate: at }], deleted: ['d'], newAnchor: 'A1' });
    expect(parseAppleHealthState(JSON.stringify(s))).toEqual(s);
  });

  it('falls back to off for missing, broken or unknown copies, and drops odd entries', () => {
    expect(parseAppleHealthState(null)).toEqual(defaultAppleHealthState());
    expect(parseAppleHealthState('{')).toEqual(defaultAppleHealthState());
    expect(parseAppleHealthState(JSON.stringify({ v: 2, enabled: true })).enabled).toBe(false);
    const odd = parseAppleHealthState(
      JSON.stringify({ v: 1, enabled: true, types: { weight_kg: 'yes', steps: true }, asked: ['weight_kg', 'smm_kg'], pending: [5, { externalId: 'x', metricKey: 'smm_kg', value: 1, measuredOn: '2026-01-01' }] }),
    );
    expect(odd.types.weight_kg).toBe(true);
    expect(odd.asked).toEqual(['weight_kg']);
    expect(odd.pending).toEqual([]);
  });
});

describe('status line and automatic sync', () => {
  const on = connect(defaultAppleHealthState(), defaultAppleHealthState().types, APPLE_HEALTH_METRICS);
  it('says how fresh the import is', () => {
    expect(appleHealthStatus(defaultAppleHealthState(), NOW)).toBe('Off');
    expect(appleHealthStatus(on, NOW)).toBe('Connected');
    expect(appleHealthStatus({ ...on, lastSyncAt: '2026-11-19T11:59:30Z' }, NOW)).toBe('Synced just now');
    expect(appleHealthStatus({ ...on, lastSyncAt: '2026-11-19T11:55:00Z' }, NOW)).toBe('Synced 5 min ago');
    expect(appleHealthStatus({ ...on, lastSyncAt: '2026-11-19T09:00:00Z' }, NOW)).toBe('Synced 3 h ago');
    expect(appleHealthStatus({ ...on, lastSyncAt: '2026-11-18T09:00:00Z' }, NOW)).toBe('Synced 1 day ago');
    expect(appleHealthStatus({ ...on, pendingDeletes: ['x'] }, NOW)).toBe('Waiting for a connection to sync');
  });
  it('syncs on open at most every 2 minutes', () => {
    expect(shouldAutoSync(on, NOW, null)).toBe(true);
    expect(shouldAutoSync(on, NOW, NOW.getTime() - 60_000)).toBe(false);
    expect(shouldAutoSync(on, NOW, NOW.getTime() - 120_000)).toBe(true);
  });
});
