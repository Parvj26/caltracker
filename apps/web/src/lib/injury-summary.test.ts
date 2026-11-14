import { describe, expect, it } from 'vitest';
import { injurySummary } from './injury-summary';

describe('injurySummary', () => {
  it('is null when nothing is noted', () => {
    expect(injurySummary('')).toBeNull();
    expect(injurySummary('  \n \n')).toBeNull();
  });

  it('shows a single note without its closing full stop', () => {
    expect(injurySummary('Left knee: no deep squats.')).toEqual({ first: 'Left knee: no deep squats', more: 0 });
  });

  it('shows the first of several lines and counts the rest, skipping blank lines and list marks', () => {
    expect(injurySummary('- Left knee: no deep squats\n\n• Lower back: no heavy deadlifts\n* Shoulder')).toEqual({
      first: 'Left knee: no deep squats',
      more: 2,
    });
  });

  it('keeps an ellipsis and other inner punctuation', () => {
    expect(injurySummary('Wrist sore... go light')).toEqual({ first: 'Wrist sore... go light', more: 0 });
  });
});
