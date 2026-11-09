import { describe, expect, it } from 'vitest';
import { bodyTile, smoothedTrend, weightTrendSummary } from '../../src/progress/body';

describe('smoothedTrend', () => {
  it('starts at the first weigh-in and moves part of the way towards each new one', () => {
    const t = smoothedTrend([
      { date: '2026-10-01', value: 80 },
      { date: '2026-10-08', value: 82 },
    ]);
    // A week later with a 7-day half-life: half way.
    expect(t).toEqual([
      { date: '2026-10-01', value: 80 },
      { date: '2026-10-08', value: 81 },
    ]);
  });
  it('lets a weigh-in a day later move the trend less than one a month later', () => {
    const day = smoothedTrend([
      { date: '2026-10-01', value: 80 },
      { date: '2026-10-02', value: 82 },
    ]);
    const month = smoothedTrend([
      { date: '2026-10-01', value: 80 },
      { date: '2026-10-31', value: 82 },
    ]);
    expect(day[1]!.value).toBeLessThan(80.3);
    expect(month[1]!.value).toBeGreaterThan(81.8);
  });
  it('treats two entries on the same day as no time apart, and handles no points', () => {
    expect(smoothedTrend([])).toEqual([]);
    expect(
      smoothedTrend([
        { date: '2026-10-01', value: 80 },
        { date: '2026-10-01', value: 90 },
      ])[1]!.value,
    ).toBe(80);
  });
});

describe('weightTrendSummary', () => {
  const trend = (a: number, b: number) => [
    { date: '2026-08-01', value: a },
    { date: '2026-11-01', value: b },
  ];
  it('says where the trend went in plain words, for a screen reader', () => {
    expect(weightTrendSummary(trend(82, 80.4), 5, 'kg', 'Last 3 months')).toBe(
      'Weight trend, last 3 months: from 82.0 kg to 80.4 kg, going down. 5 weigh-ins.',
    );
    expect(weightTrendSummary(trend(80, 80.1), 1, 'kg', 'Last 3 months')).toBe(
      'Weight trend, last 3 months: from 80.0 kg to 80.1 kg, holding steady. 1 weigh-in.',
    );
    expect(weightTrendSummary(trend(80, 81), 2, 'kg', 'All time')).toMatch(/going up/);
    expect(weightTrendSummary([], 0, 'kg', 'All time')).toBe('No weigh-ins in this range yet.');
  });
});

describe('bodyTile', () => {
  it('shows the latest weight and its 3-month change', () => {
    expect(bodyTile({ value: '182.4 lb', delta: '−2.1 lb' })).toEqual({ value: '182.4 lb', sub: '−2.1 lb in 3 months' });
    expect(bodyTile({ value: '182.4 lb', delta: null })).toEqual({ value: '182.4 lb', sub: 'latest weigh-in' });
    expect(bodyTile(null)).toEqual({ value: 'Log weight', sub: 'no weigh-ins yet' });
  });
});
