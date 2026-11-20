import { describe, expect, it } from 'vitest';
import { metricDayText, metricEntryMeta, metricEntryWho, metricValueParts } from '../../src/metrics/card';
import type { MetricEntry } from '../../src/metrics/summary';

const TODAY = '2026-11-19';
const entry = (o: Partial<MetricEntry> = {}): MetricEntry => ({
  origin: 'body_metrics',
  id: 'a',
  metricKey: 'weight_kg',
  value: 68.4,
  measuredOn: TODAY,
  measuredAt: null,
  createdAt: '2026-11-19T08:00:00Z',
  source: 'manual',
  enteredBy: 'coach',
  externalId: null,
  ...o,
});

describe('metricDayText', () => {
  it('says Today, Yesterday, else the short date (with the year when not this year)', () => {
    expect(metricDayText(TODAY, TODAY)).toBe('Today');
    expect(metricDayText('2026-11-18', TODAY)).toBe('Yesterday');
    expect(metricDayText('2026-11-12', TODAY)).toBe('12 Nov');
    expect(metricDayText('2025-03-02', TODAY)).toBe('2 Mar 2025');
  });
});

describe('metricEntryWho / metricEntryMeta', () => {
  it('names who or what entered the value, from the coach’s side', () => {
    expect(metricEntryWho(entry(), 'coach', 'Maya')).toBe('logged by you');
    expect(metricEntryWho(entry({ enteredBy: 'client' }), 'coach', 'Maya')).toBe('logged by Maya');
    expect(metricEntryWho(entry({ source: 'inbody_scan', origin: 'body_measurements' }), 'coach', 'Maya')).toBe('InBody scan');
    expect(metricEntryWho(entry({ source: 'apple_health', enteredBy: 'client' }), 'coach', 'Maya')).toBe('from Apple Health');
  });

  it('from the client’s side, the coach is "your coach"', () => {
    expect(metricEntryWho(entry(), 'client', '')).toBe('logged by your coach');
    expect(metricEntryWho(entry({ enteredBy: 'client' }), 'client', '')).toBe('logged by you');
  });

  it('falls back to "the client" with no first name', () => {
    expect(metricEntryWho(entry({ enteredBy: 'client' }), 'coach', '  ')).toBe('logged by the client');
  });

  it('joins the day and who', () => {
    expect(metricEntryMeta(entry({ measuredOn: '2026-11-12', source: 'inbody_scan' }), TODAY, 'coach', 'Maya')).toBe('12 Nov · InBody scan');
  });
});

describe('metricValueParts', () => {
  it('splits the number from its unit in the viewer’s units', () => {
    expect(metricValueParts('weight_kg', 68.4, 'kg')).toEqual({ value: '68.4', unit: 'kg' });
    expect(metricValueParts('weight_kg', 68.4, 'lb')).toEqual({ value: '150.8', unit: 'lb' });
    expect(metricValueParts('body_fat_pct', 24.1, 'kg')).toEqual({ value: '24.1', unit: '%' });
    expect(metricValueParts('resting_hr_bpm', 58, 'kg')).toEqual({ value: '58', unit: 'bpm' });
    expect(metricValueParts('waist_cm', 78, 'lb')).toEqual({ value: '30.7', unit: 'in' });
  });
});
