import { demoUrl } from './demo-link';
import { describe, expect, it } from 'vitest';
import {
  blockRounds,
  formatDayLabel,
  groupByDay,
  initials,
  isFirstTimeClient,
  orList,
  resolveVideoUrls,
  supersetLetters,
  toWorkoutSummary,
  type WorkoutSummary,
} from './workouts';

const w = (id: string, scheduledOn: string, name = `Workout ${id}`): WorkoutSummary => ({
  id,
  name,
  scheduledOn,
  exerciseCount: 3,
  programName: null,
});

describe('groupByDay', () => {
  it('returns all seven days from the given Monday, keeping empty days and item order', () => {
    const mon1 = w('a', '2026-11-09');
    const wed = w('b', '2026-11-11');
    const mon2 = w('c', '2026-11-09');
    const days = groupByDay([mon1, wed, mon2], '2026-11-09');
    expect(days.map((d) => d.date)).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
    expect(days[0]?.items).toEqual([mon1, mon2]);
    expect(days[1]?.items).toEqual([]);
    expect(days[2]?.items).toEqual([wed]);
  });

  it('ignores workouts outside the week', () => {
    const days = groupByDay([w('x', '2026-11-08'), w('y', '2026-11-16')], '2026-11-09');
    expect(days.every((d) => d.items.length === 0)).toBe(true);
  });

  it('crosses a month and year end', () => {
    const days = groupByDay([w('n', '2027-01-01')], '2026-12-28');
    expect(days[6]?.date).toBe('2027-01-03');
    expect(days[4]?.items.map((i) => i.id)).toEqual(['n']);
  });
});

describe('isFirstTimeClient', () => {
  it('is true with no workouts at all', () => {
    expect(isFirstTimeClient([])).toBe(true);
  });

  it('is false once any workout exists, past or future', () => {
    expect(isFirstTimeClient([w('past', '2020-01-01')])).toBe(false);
    expect(isFirstTimeClient([w('future', '2099-12-31')])).toBe(false);
  });
});

describe('toWorkoutSummary', () => {
  it('counts exercises across blocks and reads the program name', () => {
    expect(
      toWorkoutSummary({
        id: 'w1',
        name: 'Upper A',
        scheduled_on: '2026-11-09',
        program_assignments: { program_name: 'Strength 101' },
        workout_blocks: [{ kind: 'superset', workout_exercises: [{ count: 2 }] }, { kind: 'straight', workout_exercises: [{ count: 1 }] }],
      }),
    ).toEqual({ id: 'w1', name: 'Upper A', scheduledOn: '2026-11-09', exerciseCount: 3, programName: 'Strength 101', programDay: null });
  });

  it('reads the program week and day from the assignment start and the planned day (a moved copy keeps it)', () => {
    expect(
      toWorkoutSummary({
        id: 'w1',
        name: 'Upper A',
        scheduled_on: '2026-11-10',
        planned_on: '2026-11-09',
        program_assignments: { program_name: 'Strength 101', start_date: '2026-11-02' },
        workout_blocks: [],
      }).programDay,
    ).toEqual({ week: 2, day: 1 });
  });

  it('counts a pick-one group once: the client does one of its options', () => {
    expect(
      toWorkoutSummary({
        id: 'w3',
        name: 'Upper / Core',
        scheduled_on: '2026-11-09',
        program_assignments: null,
        workout_blocks: [{ kind: 'straight', workout_exercises: [{ count: 1 }] }, { kind: 'choice', workout_exercises: [{ count: 3 }] }],
      }).exerciseCount,
    ).toBe(2);
  });

  it('handles a one-off workout with no program and no blocks', () => {
    expect(
      toWorkoutSummary({ id: 'w2', name: 'Extra', scheduled_on: '2026-11-10', program_assignments: null, workout_blocks: [] }),
    ).toMatchObject({ exerciseCount: 0, programName: null });
  });
});

describe('resolveVideoUrls', () => {
  const ex = [
    { exerciseId: 'e1', exerciseName: 'Barbell Squat' },
    { exerciseId: 'e2', exerciseName: 'Push-up' },
    { exerciseId: 'e3', exerciseName: 'Plank Hold' },
  ];

  it('prefers the workspace override, then the exercise video, then a YouTube search', () => {
    const urls = resolveVideoUrls(
      ex,
      [
        { id: 'e1', youtube_url: 'https://youtu.be/ownvideo001' },
        { id: 'e2', youtube_url: 'https://youtu.be/ownvideo002' },
        { id: 'e3', youtube_url: null },
      ],
      [{ exercise_id: 'e1', youtube_url: 'https://youtu.be/coachvid001' }],
    );
    expect(urls.e1).toBe(demoUrl('https://youtu.be/coachvid001'));
    expect(urls.e2).toBe(demoUrl('https://youtu.be/ownvideo002'));
    expect(urls.e3).toMatch(/^https:\/\/www\.youtube\.com\/results\?search_query=.*Plank/);
  });

  it('ignores an override without a link', () => {
    const urls = resolveVideoUrls(
      [ex[0]],
      [{ id: 'e1', youtube_url: 'https://youtu.be/ownvideo001' }],
      [{ exercise_id: 'e1', youtube_url: null }],
    );
    expect(urls.e1).toBe(demoUrl('https://youtu.be/ownvideo001'));
  });

  it('skips a stored link that is not a YouTube video, falling back to the next one', () => {
    const urls = resolveVideoUrls(
      [ex[0]],
      [{ id: 'e1', youtube_url: 'https://youtu.be/ownvideo001' }],
      [{ exercise_id: 'e1', youtube_url: 'javascript:alert(1)' }],
    );
    expect(urls.e1).toBe(demoUrl('https://youtu.be/ownvideo001'));
    expect(resolveVideoUrls([ex[0]], [{ id: 'e1', youtube_url: 'https://evil.example/x' }], [])['e1']).toMatch(/results\?search_query/);
  });
});

describe('formatDayLabel', () => {
  it('formats a calendar date without going through local time', () => {
    expect(formatDayLabel('2026-11-12')).toBe('Thu 12 Nov');
    expect(formatDayLabel('2027-01-03')).toBe('Sun 3 Jan');
  });
});

describe('initials', () => {
  it('takes the first letters of the first and last words', () => {
    expect(initials('Demo Coach')).toBe('DC');
    expect(initials('Mia van der Berg')).toBe('MB');
    expect(initials('Cher')).toBe('C');
    expect(initials('  ')).toBe('?');
  });
});

describe('supersetLetters', () => {
  it('letters supersets only, counted among supersets (first A, second B)', () => {
    expect(supersetLetters([{ kind: 'straight' }, { kind: 'straight' }, { kind: 'superset' }, { kind: 'straight' }, { kind: 'superset' }])).toEqual([
      null,
      null,
      'A',
      null,
      'B',
    ]);
  });

  it('is empty for a workout with no blocks', () => {
    expect(supersetLetters([])).toEqual([]);
  });
});

describe('blockRounds', () => {
  const s = (setType: 'normal' | 'warmup' | 'drop') => ({ setType });
  it('counts rounds per block as its longest exercise, not counting drops', () => {
    expect(
      blockRounds([
        { exercises: [{ sets: [s('warmup'), s('normal'), s('drop'), s('normal')] }] },
        { exercises: [{ sets: [s('normal'), s('normal')] }, { sets: [s('normal'), s('drop'), s('normal')] }] },
        { exercises: [] },
      ]),
    ).toEqual([3, 2, 0]);
  });

  it('throws on a leading drop, so the screen can show its error instead of crashing while drawing', () => {
    expect(() => blockRounds([{ exercises: [{ sets: [s('drop'), s('normal')] }] }])).toThrow(
      'A drop set must follow a normal or warm-up set.',
    );
  });
});

describe('orList', () => {
  it('joins two names with "or"', () => {
    expect(orList(['Medicine Ball Slam', "Farmer's Walk"])).toBe("Medicine Ball Slam or Farmer's Walk");
  });

  it('joins three or more with commas and a last "or"', () => {
    expect(orList(['A', 'B', 'C'])).toBe('A, B or C');
  });

  it('gives one name alone, and nothing for none', () => {
    expect(orList(['A'])).toBe('A');
    expect(orList([])).toBe('');
  });
});
