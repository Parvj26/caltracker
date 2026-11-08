import { describe, expect, it } from 'vitest';
import { sanitize } from '../../src/analytics/sanitize';

describe('sanitize', () => {
  it('keeps only allowed keys', () => {
    expect(sanitize('task_completed', { task: 'log_meal', taps: 4, weight_kg: 80, note: 'x' })).toEqual({ task: 'log_meal', taps: 4 });
  });
  it('allows query only on exercise_search_no_results', () => {
    expect(sanitize('error_shown', { query: 'bench' })).toEqual({});
    expect(sanitize('exercise_search_no_results', { query: 'x'.repeat(80) }).query).toHaveLength(60);
  });
  it('drops non-primitive values', () => {
    expect(sanitize('task_started', { task: { a: 1 }, taps: [1], screen: () => 1, variant: true })).toEqual({ variant: true });
  });
  it('handles undefined props', () => {
    expect(sanitize('app_opened', undefined)).toEqual({});
  });
});
