import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StrengthPoint } from '@caltracker/shared';
import { StrengthPanel } from './strength-panel';

const pt = (date: string, weightKg: number, reps: number): StrengthPoint => ({
  date,
  e1rmKg: Math.round(weightKg * (1 + reps / 30) * 10) / 10,
  bestSet: { weightKg, reps },
  heaviestSet: { weightKg, reps },
  logId: `log-${date}`,
  logName: 'Lower Body',
});

describe('StrengthPanel', () => {
  it('headlines the heaviest weight with the estimated 1-rep max second, like Metrics › Strength', () => {
    const html = renderToStaticMarkup(
      <StrengthPanel data={[{ exerciseId: 'sq', name: 'Barbell Squat', points: [pt('2026-09-02', 45, 8), pt('2026-11-17', 62.5, 8)] }]} units="kg" today="2026-11-19" />,
    );
    expect(html).toContain('Heaviest weight 62.5 kg · +17.5 kg since 2 Sep');
    expect(html).toContain('Est. 1-rep max 79.2 kg · From 62.5 kg × 8');
    expect(html).toContain('heaviest weight per session and estimated 1-rep max');
    expect(html).not.toMatch(/est\. max\b|estimated one-rep max over time/);
  });

  it('says when there is nothing to chart', () => {
    expect(renderToStaticMarkup(<StrengthPanel data={[]} units="kg" today="2026-11-19" />)).toContain('No lifts to chart yet');
  });
});
