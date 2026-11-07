import { describe, expect, it } from 'vitest';
import { pickerSections, workoutHints } from '../../src/programs/picker-hints';

const lib = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);

describe('workoutHints', () => {
  it('recent: the last-used library workouts, newest first, each once', () => {
    const used = ['c', 'a', 'c', 'b', 'a'];
    expect(workoutHints(used, lib).recent).toEqual(['c', 'a', 'b']);
  });

  it('keeps at most 8 recent', () => {
    const used = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    expect(workoutHints(used, lib).recent).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('skips workouts no longer in the library, and copies with no source', () => {
    expect(workoutHints(['gone', null, 'b'], lib).recent).toEqual(['b']);
  });

  it('most used: used twice or more and not already recent, most first (ties: most recent first)', () => {
    // Recent takes the first 8 distinct: a..h. i and j are older; j used 3 times, i twice.
    const used = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'j', 'i', 'j', 'a'];
    const hints = workoutHints(used, lib);
    expect(hints.mostUsed).toEqual(['j', 'i']);
  });

  it('most used is empty when everything used is already recent, and caps at 8', () => {
    expect(workoutHints(['a', 'a', 'b'], lib).mostUsed).toEqual([]);
    const many = new Set(Array.from({ length: 30 }, (_, i) => `w${i}`));
    const used = [...Array.from({ length: 8 }, (_, i) => `w${i}`), ...Array.from({ length: 20 }, (_, i) => [`w${i + 8}`, `w${i + 8}`]).flat()];
    expect(workoutHints(used, many).mostUsed).toHaveLength(8);
  });
});

describe('pickerSections', () => {
  const library = [
    { id: 'a', name: 'Arms' },
    { id: 'b', name: 'Back' },
    { id: 'c', name: 'Chest' },
    { id: 'd', name: 'Legs' },
  ];

  it('puts Recent, then Most used, then everything else once, in library order', () => {
    expect(pickerSections(library, { recent: ['c', 'a'], mostUsed: ['d'] })).toEqual({
      recent: [library[2], library[0]],
      mostUsed: [library[3]],
      rest: [library[1]],
    });
  });

  it('with no hints, everything is in the rest', () => {
    expect(pickerSections(library, { recent: [], mostUsed: [] })).toEqual({ recent: [], mostUsed: [], rest: library });
  });

  it('ignores hints for workouts not in the list', () => {
    expect(pickerSections(library, { recent: ['zz'], mostUsed: ['yy'] }).rest).toEqual(library);
  });
});
