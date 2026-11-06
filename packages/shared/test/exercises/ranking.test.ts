import { describe, expect, it } from 'vitest';
import { COMMON_EXERCISES } from '../../src/exercises/popular';
import { buildExerciseIndex, searchExercises, type SearchBoosts, type SearchFilters } from '../../src/exercises/search';
import { EXERCISE_OTHER_NAMES } from '../../src/exercises/synonyms';
import { LIBRARY } from './fixtures/library';

// This guards against an accidental O(n²) slowdown (many seconds), not runner speed, so CI gets a roomy budget.
const PERF_BUDGET_MS = process.env.CI ? 1500 : 100;
// Vitest's default 5 s limit times every pass, warm-ups included; on a busy CI runner that alone can exceed it.
// The speed budget above is the real check, so give the whole loop room to finish.
const PERF_TEST_TIMEOUT_MS = 30_000;

const NO_FILTERS: SearchFilters = { muscles: [], equipment: [], customOnly: false };
const NO_BOOSTS: SearchBoosts = { favourites: new Set(), recent: [] };
const index = buildExerciseIndex(LIBRARY);
const names = (q: string, boosts: SearchBoosts = NO_BOOSTS) =>
  searchExercises(index, q, NO_FILTERS, boosts).map((h) => h.row.name);
const idOf = (name: string) => LIBRARY.find((r) => r.name === name)?.id ?? '';

describe('the common-exercises list', () => {
  it('names only library exercises, each once', () => {
    const library = new Set(LIBRARY.map((r) => r.name));
    expect(COMMON_EXERCISES.filter((n) => !library.has(n))).toEqual([]);
    expect(new Set(COMMON_EXERCISES).size).toBe(COMMON_EXERCISES.length);
  });
});

describe('a coach finds the lift they mean first (real library)', () => {
  it('"bench" -> a bench press, not Bench Dips', () => {
    expect(['Barbell Bench Press - Medium Grip', 'Dumbbell Bench Press']).toContain(names('bench')[0]);
  });

  it('"lat" -> Wide-Grip Lat Pulldown', () => {
    expect(names('lat')[0]).toBe('Wide-Grip Lat Pulldown');
  });

  it('"deadlft" (a typo) -> Barbell Deadlift', () => {
    expect(names('deadlft')[0]).toBe('Barbell Deadlift');
  });

  it('"db incline" -> Incline Dumbbell Press, above Dumbbell Incline Row', () => {
    const found = names('db incline');
    expect(found[0]).toBe('Incline Dumbbell Press');
    expect(found.indexOf('Incline Dumbbell Press')).toBeLessThan(found.indexOf('Dumbbell Incline Row'));
  });

  it('"curl" -> common curls first', () => {
    const common = ['Dumbbell Bicep Curl', 'Barbell Curl', 'EZ-Bar Curl', 'Hammer Curls', 'Standing Biceps Cable Curl', 'Preacher Curl'];
    for (const n of names('curl').slice(0, 3)) expect(common).toContain(n);
  });

  it('"dip" -> the two parallel-bar dips first', () => {
    expect(names('dip').slice(0, 2).sort()).toEqual(['Dips - Chest Version', 'Dips - Triceps Version']);
  });

  it('a favourite still beats a popular exercise', () => {
    expect(names('bench', { favourites: new Set([idOf('Bench Dips')]), recent: [] })[0]).toBe('Bench Dips');
  });

  it('a recent exercise still beats a popular exercise', () => {
    expect(names('bench', { favourites: new Set(), recent: [idOf('Bench Jump')] })[0]).toBe('Bench Jump');
  });

  it('the whole name typed still beats popularity ("bench dips" -> Bench Dips)', () => {
    expect(names('bench dips')[0]).toBe('Bench Dips');
  });
});

describe('performance (real library)', () => {
  it('886 rows plus their other names, 50 queries in within the speed budget', () => {
    const idx = buildExerciseIndex(LIBRARY);
    const otherNames = Object.values(EXERCISE_OTHER_NAMES).reduce((n, o) => n + o.length, 0);
    expect(idx.entries.length).toBe(LIBRARY.length + otherNames);
    const queries = ['bench', 'db incline', 'curl', 'deadlft', 'lat pulldown', 'ohp', 'xyzzy plugh', 'seated row', 'tricep', 'barbel squat'];
    // Untimed warm-up passes so JIT compilation is not counted.
    for (let i = 0; i < 3; i++) for (const q of queries) searchExercises(idx, q, NO_FILTERS, NO_BOOSTS);
    // Alone, the 10 queries take about 3 ms. `pnpm check` runs every suite and typecheck at once, which can stall a
    // long timed block, so time many short passes of the 10 and keep the quickest: 50 queries = 5 such passes.
    let best = Infinity;
    for (let run = 0; run < 40; run++) {
      const t0 = performance.now();
      for (const q of queries) searchExercises(idx, q, NO_FILTERS, NO_BOOSTS);
      best = Math.min(best, (performance.now() - t0) * 5);
    }
    expect(best).toBeLessThan(PERF_BUDGET_MS);
  }, PERF_TEST_TIMEOUT_MS);
});
