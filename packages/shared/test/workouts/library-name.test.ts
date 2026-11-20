import { describe, expect, it } from 'vitest';
import { clientCopyName, libraryNameKey, libraryNameTaken } from '../../src/workouts/library-name';

describe('Save to Library names', () => {
  it('compares names ignoring case and extra spaces', () => {
    expect(libraryNameKey('  Monday   Upper ')).toBe('monday upper');
    expect(libraryNameTaken('monday upper', ['Legs', 'Monday Upper'])).toBe(true);
    expect(libraryNameTaken('Monday Upper 2', ['Monday Upper'])).toBe(false);
    expect(libraryNameTaken('Anything', [])).toBe(false);
  });

  it('offers "<name> (<first name>, <day>)" on a clash, like a program day copy', () => {
    expect(clientCopyName('Monday Upper', 'Vaishali', '2026-11-20')).toBe('Monday Upper (Vaishali, Fri 20 Nov)');
    expect(clientCopyName('  Monday Upper ', ' ', '2026-11-20')).toBe('Monday Upper (Fri 20 Nov)');
  });

  it('shortens a long name so the result fits 100 characters', () => {
    const long = `${'Upper body push and pull '.repeat(5)}day`;
    const out = clientCopyName(long, 'Vaishali', '2026-11-20');
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(' (Vaishali, Fri 20 Nov)')).toBe(true);
  });
});
