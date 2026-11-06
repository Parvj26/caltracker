import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_CHIPS,
  EXERCISE_ALIASES,
  EXERCISE_INDEX_COLUMNS,
  MUSCLE_CHIPS,
  MUSCLE_CHIP_MUSCLES,
  buildExerciseIndex,
  equipmentChipOf,
  exerciseIndexRowFromDb,
  normalizeSearchText,
  searchExercises,
  type ExerciseIndexRow,
  type SearchBoosts,
  type SearchFilters,
} from '../../src/exercises/search';

// Shared CI runners are several times slower than a developer machine; the budget still catches
// a real regression (an order-of-magnitude slowdown) without flaking on a busy runner.
const PERF_BUDGET_MS = process.env.CI ? 500 : 100;
// Vitest's default 5 s limit times every pass, warm-ups included; on a busy CI runner that alone can exceed it.
// The speed budget above is the real check, so give the whole loop room to finish.
const PERF_TEST_TIMEOUT_MS = 30_000;

function row(
  name: string,
  o: Partial<ExerciseIndexRow> & { id?: string } = {},
): ExerciseIndexRow {
  return {
    id: o.id ?? name,
    name,
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: null,
    category: 'strength',
    trackingType: 'weight_reps',
    source: 'builtin',
    imagePath: null,
    ...o,
  };
}

const ROWS: ExerciseIndexRow[] = [
  row('Dumbbell Incline Bench Press', { primaryMuscles: ['chest'], secondaryMuscles: ['shoulders', 'triceps'], equipment: 'dumbbell' }),
  row('Incline Dumbbell Fly', { primaryMuscles: ['chest'], equipment: 'dumbbell' }),
  row('Barbell Bench Press - Medium Grip', { primaryMuscles: ['chest'], secondaryMuscles: ['shoulders', 'triceps'], equipment: 'barbell' }),
  row('Standing Military Press', { primaryMuscles: ['shoulders'], secondaryMuscles: ['triceps'], equipment: 'barbell' }),
  row('Seated Barbell Military Press', { primaryMuscles: ['shoulders'], secondaryMuscles: ['triceps'], equipment: 'barbell' }),
  row('Romanian Deadlift', { primaryMuscles: ['hamstrings'], secondaryMuscles: ['glutes', 'lower back'], equipment: 'barbell' }),
  row('Barbell Curl', { primaryMuscles: ['biceps'], secondaryMuscles: ['forearms'], equipment: 'barbell' }),
  row('Hammer Curls', { primaryMuscles: ['biceps'], equipment: 'dumbbell' }),
  row('T-Bar Row', { primaryMuscles: ['middle back'], secondaryMuscles: ['lats', 'biceps'], equipment: 'other' }),
  row('Lat Pulldown', { primaryMuscles: ['lats'], secondaryMuscles: ['biceps', 'middle back'], equipment: 'cable' }),
  row('Crunches', { primaryMuscles: ['abdominals'], equipment: 'body only' }),
  row('Barbell Squat', { primaryMuscles: ['quadriceps'], secondaryMuscles: ['glutes', 'hamstrings'], equipment: 'barbell' }),
  row('Bodyweight Squat', { primaryMuscles: ['quadriceps'], secondaryMuscles: ['glutes'], equipment: 'body only' }),
  row('Cable Crossover', { primaryMuscles: ['chest'], secondaryMuscles: ['shoulders'], equipment: 'cable' }),
  row('Glute Bridge', { primaryMuscles: ['glutes'], equipment: 'body only' }),
  row('Low-Incline DB Press', { primaryMuscles: ['chest'], equipment: 'dumbbell', source: 'custom' }),
];

const index = buildExerciseIndex(ROWS);
const NO_FILTERS: SearchFilters = { muscles: [], equipment: [], customOnly: false };
const NO_BOOSTS: SearchBoosts = { favourites: new Set(), recent: [] };

function names(query: string, filters = NO_FILTERS, boosts = NO_BOOSTS): string[] {
  return searchExercises(index, query, filters, boosts).map((h) => h.row.name);
}
function hits(query: string) {
  return searchExercises(index, query, NO_FILTERS, NO_BOOSTS);
}

describe('aliases and word order', () => {
  it('expands db and ignores word order', () => {
    expect(names('db incline')[0]).toBe('Dumbbell Incline Bench Press');
    expect(names('press incline dumbbell')[0]).toBe('Dumbbell Incline Bench Press');
  });

  it('ohp finds the military presses, not bench press', () => {
    const found = names('ohp');
    expect(found).toEqual(expect.arrayContaining(['Standing Military Press', 'Seated Barbell Military Press']));
    expect(found.some((n) => n.includes('Bench Press'))).toBe(false);
  });

  it('rdl finds Romanian Deadlift first', () => {
    expect(names('rdl')[0]).toBe('Romanian Deadlift');
  });

  it('has about 40 aliases', () => {
    expect(Object.keys(EXERCISE_ALIASES).length).toBeGreaterThanOrEqual(40);
  });
});

describe('word endings and typos', () => {
  it('curls matches Barbell Curl', () => {
    expect(names('curls')).toContain('Barbell Curl');
  });

  it('squatting matches squat names', () => {
    expect(names('squatting')).toContain('Barbell Squat');
  });

  it('dumbel incline still matches, as tier 4', () => {
    const h = hits('dumbel incline').find((x) => x.row.name === 'Dumbbell Incline Bench Press');
    expect(h?.tier).toBe(4);
  });

  it('cul does not match Barbell Curl', () => {
    expect(names('cul')).not.toContain('Barbell Curl');
  });
});

describe('joined and punctuated forms', () => {
  it.each(['t-bar row', 'tbar row', 'T Bar Row'])('%s gives T-Bar Row first', (q) => {
    expect(names(q)[0]).toBe('T-Bar Row');
  });

  it('benchpress matches Bench Press', () => {
    expect(names('benchpress')).toContain('Barbell Bench Press - Medium Grip');
  });
});

describe('short aliases and muscle-only matches', () => {
  it('ab matches Crunches at tier 5 and not Lat Pulldown', () => {
    const h = hits('ab');
    expect(h.find((x) => x.row.name === 'Crunches')?.tier).toBe(5);
    expect(h.map((x) => x.row.name)).not.toContain('Lat Pulldown');
  });

  it('glutes: muscle-only matches are tier 5 and come after name matches', () => {
    const h = hits('glutes');
    expect(h[0]?.row.name).toBe('Glute Bridge');
    expect(h[0]?.tier).toBe(3);
    const squat = h.find((x) => x.row.name === 'Barbell Squat');
    expect(squat?.tier).toBe(5);
    const firstFive = h.findIndex((x) => x.tier === 5);
    expect(h.slice(firstFive).every((x) => x.tier === 5)).toBe(true);
  });
});

describe('empty query, filters, ties', () => {
  it('orders favourites, then recents, then A to Z', () => {
    const boosts: SearchBoosts = {
      favourites: new Set(['Hammer Curls']),
      recent: ['Crunches', 'Cable Crossover'],
    };
    const h = searchExercises(index, '', NO_FILTERS, boosts);
    expect(h.every((x) => x.tier === 0)).toBe(true);
    const order = h.map((x) => x.row.name);
    expect(order.slice(0, 3)).toEqual(['Hammer Curls', 'Crunches', 'Cable Crossover']);
    const rest = order.slice(3);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
    expect(order).toHaveLength(ROWS.length);
  });

  it('filters by muscle chip and equipment chip', () => {
    const found = names('', { muscles: ['Chest'], equipment: ['Dumbbell'], customOnly: false });
    expect(found.sort()).toEqual(
      ['Dumbbell Incline Bench Press', 'Incline Dumbbell Fly', 'Low-Incline DB Press'].sort(),
    );
  });

  it('filters apply with a query too', () => {
    const found = names('press', { muscles: ['Shoulders'], equipment: [], customOnly: false });
    expect(found.sort()).toEqual(['Seated Barbell Military Press', 'Standing Military Press']);
  });

  it('customOnly gives only custom exercises', () => {
    expect(names('', { muscles: [], equipment: [], customOnly: true })).toEqual(['Low-Incline DB Press']);
  });

  it('ties go to the favourite, then the recent one', () => {
    expect(
      names('press', NO_FILTERS, { favourites: new Set(['Seated Barbell Military Press']), recent: [] })[0],
    ).toBe('Seated Barbell Military Press');
    expect(
      names('press', NO_FILTERS, { favourites: new Set(), recent: ['Standing Military Press'] })[0],
    ).toBe('Standing Military Press');
  });
});

describe('plain names rank first', () => {
  const idx = buildExerciseIndex([
    row('Squat Jerk', { equipment: 'barbell', primaryMuscles: ['quadriceps'] }),
    row('Barbell Squat', { equipment: 'barbell', primaryMuscles: ['quadriceps'] }),
    row('Bicep Curl Machine', { equipment: 'machine', primaryMuscles: ['biceps'] }),
    row('Dumbbell Bicep Curl', { equipment: 'dumbbell', primaryMuscles: ['biceps'] }),
  ]);
  const top = (q: string) => searchExercises(idx, q, NO_FILTERS, NO_BOOSTS).map((h) => h.row.name);
  it('"squat" puts Barbell Squat ahead of Squat Jerk', () => {
    const r = searchExercises(idx, 'squat', NO_FILTERS, NO_BOOSTS);
    expect(r[0]?.row.name).toBe('Barbell Squat');
    expect(r[0]?.tier).toBe(1);
  });
  it('"bicep curl" puts Dumbbell Bicep Curl ahead of Bicep Curl Machine', () => {
    expect(top('bicep curl')[0]).toBe('Dumbbell Bicep Curl');
  });
});

describe('plain names with other leading equipment', () => {
  const idx = buildExerciseIndex([
    row('Smith Machine Squat Jump', { equipment: 'machine' }),
    row('Smith Machine Squat', { equipment: 'machine' }),
    row('Squat Jerk', { equipment: 'barbell' }),
    row('Ez-Bar Curl', { equipment: 'e-z curl bar' }),
    row('Curl Up', { equipment: 'body only' }),
    row('Bodyweight', { equipment: 'body only' }),
  ]);
  const first = (q: string) => searchExercises(idx, q, NO_FILTERS, NO_BOOSTS)[0];
  it('"squat" ranks "Smith Machine Squat" as an exact plain name, ahead of Squat Jerk', () => {
    expect(first('squat')?.row.name).toBe('Smith Machine Squat');
    expect(first('squat')?.tier).toBe(1);
  });
  it('"curl" ranks "Ez-Bar Curl" as an exact plain name, ahead of Curl Up', () => {
    expect(first('curl')?.row.name).toBe('Ez-Bar Curl');
    expect(first('curl')?.tier).toBe(1);
  });
  it('a name that is only an equipment word still matches itself', () => {
    expect(first('bodyweight')?.row.name).toBe('Bodyweight');
  });
});

describe('highlight', () => {
  it('covers the matched name words', () => {
    const h = hits('incline dumbbell').find((x) => x.row.name === 'Dumbbell Incline Bench Press');
    const parts = (h?.highlight ?? []).map(([s, e]) => 'Dumbbell Incline Bench Press'.slice(s, e));
    expect(parts).toEqual(['Dumbbell', 'Incline']);
  });

  it('is empty when the match was through muscles only', () => {
    expect(hits('ab').find((x) => x.row.name === 'Crunches')?.highlight).toEqual([]);
  });
});

describe('normalizeSearchText', () => {
  it('strips accents, case and punctuation', () => {
    expect(normalizeSearchText('Crème  Brûlée-Press')).toBe('creme brulee press');
  });
});

describe('chips', () => {
  it('maps equipment to chips', () => {
    expect(equipmentChipOf('barbell')).toBe('Barbell');
    expect(equipmentChipOf('body only')).toBe('Bodyweight');
    expect(equipmentChipOf('bands')).toBe('Band');
    expect(equipmentChipOf('kettlebells')).toBe('Kettlebell');
    expect(equipmentChipOf(null)).toBe('Other');
    expect(equipmentChipOf('foam roll')).toBe('Other');
  });

  it('maps every muscle in the real library to some chip', () => {
    // Fixture of the real library, plus "neck", which the full dataset has but the fixture does not.
    const fixture = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../../scripts/fixtures/free-exercise-db/exercises.json', import.meta.url)),
        'utf8',
      ),
    ) as Array<{ primaryMuscles: string[]; secondaryMuscles: string[] }>;
    const muscles = new Set<string>(['neck']);
    for (const e of fixture) for (const m of [...e.primaryMuscles, ...e.secondaryMuscles]) muscles.add(m);
    expect(muscles.size).toBeGreaterThanOrEqual(16);
    const mapped = new Set(Object.values(MUSCLE_CHIP_MUSCLES).flat());
    expect([...muscles].filter((m) => !mapped.has(m))).toEqual([]);
  });

  it('lists every chip once, in the order the pickers show them', () => {
    expect(MUSCLE_CHIPS).toEqual(['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Glutes', 'Core', 'Full body']);
    expect(EQUIPMENT_CHIPS).toEqual(['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Kettlebell', 'Bodyweight', 'Band', 'Other']);
    expect([...MUSCLE_CHIPS].sort()).toEqual(Object.keys(MUSCLE_CHIP_MUSCLES).sort());
  });

  it('Full body matches strongman or 4+ muscles', () => {
    const idx = buildExerciseIndex([
      row('Atlas Stone', { id: 'a', category: 'strongman', primaryMuscles: ['lats'] }),
      row('Clean', { id: 'b', primaryMuscles: ['quadriceps', 'glutes'], secondaryMuscles: ['traps', 'shoulders'] }),
      row('Curl', { id: 'c', primaryMuscles: ['biceps'] }),
    ]);
    const found = searchExercises(idx, '', { muscles: ['Full body'], equipment: [], customOnly: false }, NO_BOOSTS);
    expect(found.map((h) => h.row.id).sort()).toEqual(['a', 'b']);
  });
});

describe('word boundaries', () => {
  const idx = buildExerciseIndex([
    row('Bench Sprint', { id: 'sprint' }),
    row('Barbell Curl', { id: 'curl' }),
    row('Barbell Bench Press', { id: 'bp' }),
    row('Cre\u0301me Press', { id: 'creme' }),
    row('Zercher Squat', { id: 'z' }),
    row('\u00c9tirement', { id: 'e' }),
    row('Lateral Bound', { id: 'lb' }),
    row('Lat Pulldown - Wide Grip', { id: 'lp' }),
  ]);
  const ids = (q: string) => searchExercises(idx, q, NO_FILTERS, NO_BOOSTS).map((h) => h.row.id);

  it('a short stem is not a prefix: spring does not match Bench Sprint', () => {
    // "spring" is one typo away from "sprint", so it may still show up, but only as a tier 4 typo match.
    const spring = searchExercises(idx, 'spring', NO_FILTERS, NO_BOOSTS).find((h) => h.row.id === 'sprint');
    expect(spring === undefined || spring.tier === 4).toBe(true);
    expect(ids('speed')).not.toContain('sprint');
  });

  it('a joined match must start at a word start', () => {
    expect(ids('bellc')).not.toContain('curl');
    expect(ids('ellcu')).not.toContain('curl');
    expect(ids('benchpress')).toContain('bp');
  });

  it('decomposed accents stay inside their word', () => {
    const h = searchExercises(idx, 'creme press', NO_FILTERS, NO_BOOSTS).find((x) => x.row.id === 'creme');
    expect(h?.tier).toBe(1);
    expect(h?.highlight).toEqual([[0, 6], [7, 12]]);
    expect(h?.row.name.slice(...(h.highlight[0] as [number, number]))).toBe('Cre\u0301me');
  });

  it('sorts accented names with their base letter', () => {
    const order = searchExercises(idx, '', NO_FILTERS, NO_BOOSTS).map((h) => h.row.id);
    expect(order.indexOf('e')).toBeLessThan(order.indexOf('z'));
  });

  it('whole-word matches rank above word-start matches in the same tier', () => {
    expect(ids('lat').slice(0, 2)).toEqual(['lp', 'lb']);
  });
});

describe('performance', () => {
  it('1,000 rows and 50 queries in within the speed budget', () => {
    const words = ['barbell', 'dumbbell', 'press', 'curl', 'row', 'squat', 'incline', 'cable', 'fly', 'lunge', 'raise', 'extension', 'bridge', 'machine', 'seated', 'standing'];
    const rows = Array.from({ length: 1000 }, (_, i) =>
      row(`${words[i % 16]} ${words[(i * 7 + 3) % 16]} ${words[(i * 5 + 1) % 16]} ${i}`, {
        id: String(i),
        primaryMuscles: ['chest'],
        equipment: 'barbell',
      }),
    );
    const idx = buildExerciseIndex(rows);
    const queries = ['db incline', 'curls', 'dumbel press', 'benchpress', 'ohp', 'xyzzy plugh', 'seated row', 'lunges', 'ab', 'barbel squat'];
    // One untimed pass so JIT warm-up is not counted.
    for (const q of queries) searchExercises(idx, q, NO_FILTERS, NO_BOOSTS);
    // Best of 7 runs: a busy machine (other test suites in parallel) can stall one run, not all of them.
    let best = Infinity;
    for (let run = 0; run < 7; run++) {
      const t0 = performance.now();
      for (let i = 0; i < 50; i++) searchExercises(idx, queries[i % queries.length] ?? '', NO_FILTERS, NO_BOOSTS);
      best = Math.min(best, performance.now() - t0);
    }
    // A generous budget: the real cost is a few ms, but a busy machine (several test suites in parallel) can slow it.
    expect(best).toBeLessThan(PERF_BUDGET_MS);
  }, PERF_TEST_TIMEOUT_MS);
});

describe('exerciseIndexRowFromDb', () => {
  const db = {
    id: 'e1',
    name: 'Barbell Curl',
    primary_muscles: ['biceps'],
    secondary_muscles: ['forearms'],
    equipment: 'barbell',
    category: 'strength',
    tracking_type: 'weight_reps' as const,
    source: 'free-exercise-db',
    image_paths: ['a/0.jpg', 'a/1.jpg'],
  };

  it('selects exactly the columns it reads', () => {
    expect(EXERCISE_INDEX_COLUMNS.split(', ').sort()).toEqual(Object.keys(db).sort());
  });

  it('maps a library row, keeping the first photo only', () => {
    expect(exerciseIndexRowFromDb(db)).toEqual({
      id: 'e1',
      name: 'Barbell Curl',
      primaryMuscles: ['biceps'],
      secondaryMuscles: ['forearms'],
      equipment: 'barbell',
      category: 'strength',
      trackingType: 'weight_reps',
      source: 'builtin',
      imagePath: 'a/0.jpg',
    });
  });

  it('marks custom exercises and allows no photo', () => {
    expect(exerciseIndexRowFromDb({ ...db, source: 'custom', image_paths: [] })).toMatchObject({ source: 'custom', imagePath: null });
  });
});
