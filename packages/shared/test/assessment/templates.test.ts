import { describe, expect, it } from 'vitest';
import { TEMPLATE_NAME_MAX, checkTemplateInput, resolveTemplate, templateNameProblem } from '../../src/assessment/templates';

describe('checkTemplateInput', () => {
  it('trims the name and keeps the order of the tests', () => {
    expect(checkTemplateInput({ name: '  My  lower-body screen ', testKeys: ['single_leg_squat', 'overhead_squat'] })).toEqual({
      name: 'My lower-body screen',
      testKeys: ['single_leg_squat', 'overhead_squat'],
    });
  });

  it('refuses empty or long names, no tests, too many, repeats and odd keys', () => {
    expect(checkTemplateInput({ name: '   ', testKeys: ['overhead_squat'] })).toBeNull();
    expect(checkTemplateInput({ name: 'x'.repeat(TEMPLATE_NAME_MAX + 1), testKeys: ['overhead_squat'] })).toBeNull();
    expect(checkTemplateInput({ name: 'A', testKeys: [] })).toBeNull();
    expect(checkTemplateInput({ name: 'A', testKeys: Array.from({ length: 21 }, (_, i) => `t_${i}`) })).toBeNull();
    expect(checkTemplateInput({ name: 'A', testKeys: ['overhead_squat', 'overhead_squat'] })).toBeNull();
    expect(checkTemplateInput({ name: 'A', testKeys: ['Overhead Squat'] })).toBeNull();
    expect(checkTemplateInput({ name: 'A', testKeys: [1] })).toBeNull();
    expect(checkTemplateInput(null)).toBeNull();
  });
});

describe('templateNameProblem', () => {
  it('flags empty, long and taken names (case and spaces ignored)', () => {
    expect(templateNameProblem(' ', [])).toBe('empty');
    expect(templateNameProblem('x'.repeat(61), [])).toBe('too_long');
    expect(templateNameProblem('my first  screen', ['My first screen'])).toBe('taken');
    expect(templateNameProblem('Full-body screen', ['My first screen'])).toBeNull();
  });
});

describe('resolveTemplate', () => {
  it('keeps offered tests in the template order and lists the retired ones', () => {
    expect(resolveTemplate(['push_up', 'old_test', 'overhead_squat'], ['overhead_squat', 'push_up'])).toEqual({
      keys: ['push_up', 'overhead_squat'],
      missing: ['old_test'],
    });
  });
});
