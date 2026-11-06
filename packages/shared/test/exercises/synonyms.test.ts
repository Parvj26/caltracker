import { describe, expect, it } from 'vitest';
import {
  buildExerciseIndex,
  normalizeSearchText,
  searchExercises,
  type ExerciseIndexRow,
  type SearchBoosts,
  type SearchFilters,
} from '../../src/exercises/search';
import { EXERCISE_OTHER_NAMES } from '../../src/exercises/synonyms';
import { LIBRARY } from './fixtures/library';

const NO_FILTERS: SearchFilters = { muscles: [], equipment: [], customOnly: false };
const NO_BOOSTS: SearchBoosts = { favourites: new Set(), recent: [] };
const index = buildExerciseIndex(LIBRARY);
const top = (q: string) => searchExercises(index, q, NO_FILTERS, NO_BOOSTS)[0]?.row.name;

/** Names from the trainer's current app, then other common gym names, with the library exercise each should find first. */
const TRAINER_APP: Array<[query: string, expected: string]> = [
  ['Leg Press', 'Leg Press'],
  ['Medicine Ball Standing Overhead Throw', 'Standing Two-Arm Overhead Throw'],
  ['Calf Raise On Leg Press', 'Calf Press On The Leg Press Machine'],
  ['Leg Press Calf Raises', 'Calf Press On The Leg Press Machine'],
  ['Dumbbell Bicep Curl', 'Dumbbell Bicep Curl'],
  ['Alternating Dumbbell Bicep Curl', 'Dumbbell Alternate Bicep Curl'],
  ['Dumbbell Lateral Raise', 'Side Lateral Raise'],
  ['Dumbbell Chest Fly', 'Dumbbell Flyes'],
  ['Dumbbell Concentration Curl', 'Concentration Curls'],
  ['Farmers Walk', "Farmer's Walk"],
  ['Cable Tricep Pushdown', 'Triceps Pushdown'],
  ['Dumbbell Bench Press', 'Dumbbell Bench Press'],
  ['Lat Pulldown', 'Wide-Grip Lat Pulldown'],
  ['Dumbbell Seated Overhead Press', 'Seated Dumbbell Press'],
  ['Medicine Ball Slam', 'Overhead Slam'],
  ['Hanging Leg Raise', 'Hanging Leg Raise'],
];

/**
 * Trainer-app names that a separate branch adds to the library as built-in exercises of their own.
 * Enabled once the library extras land: each must then find itself, so no other name maps these to a
 * close variant (that would fight the exact entry).
 */
const LIBRARY_EXTRAS: string[] = [
  'Dumbbell Walking Lunge',
  'Medicine Ball Russian Twist',
  'Side Plank Single Leg Crunch',
  'Hip Thrust Machine',
  'Crunch Clap',
  'Medicine Ball Sit Up & Overhead Throw',
  'Kettlebell Upright Row',
  'Kettlebell Sumo Squat',
  'Dumbbell Romanian Deadlift',
  'Machine Assisted Pull Up',
];

const COMMON: Array<[query: string, expected: string]> = [
  // Chest
  ['Bench Press', 'Barbell Bench Press - Medium Grip'],
  ['Barbell Bench Press', 'Barbell Bench Press - Medium Grip'],
  ['Flat Bench Press', 'Barbell Bench Press - Medium Grip'],
  ['Incline Bench Press', 'Barbell Incline Bench Press - Medium Grip'],
  ['Incline Barbell Bench Press', 'Barbell Incline Bench Press - Medium Grip'],
  ['Incline Dumbbell Press', 'Incline Dumbbell Press'],
  ['Incline Dumbbell Bench Press', 'Incline Dumbbell Press'],
  ['Decline Bench Press', 'Decline Barbell Bench Press'],
  ['Close Grip Bench Press', 'Close-Grip Barbell Bench Press'],
  ['Chest Press Machine', 'Leverage Chest Press'],
  ['Machine Chest Press', 'Leverage Chest Press'],
  ['Pec Deck', 'Butterfly'],
  ['Machine Fly', 'Butterfly'],
  ['Cable Fly', 'Cable Crossover'],
  ['Cable Chest Fly', 'Cable Crossover'],
  ['Low To High Cable Fly', 'Low Cable Crossover'],
  ['Dumbbell Fly', 'Dumbbell Flyes'],
  ['Incline Dumbbell Fly', 'Incline Dumbbell Flyes'],
  ['Push Up', 'Pushups'],
  ['Push-ups', 'Pushups'],
  ['Diamond Push Up', 'Push-Ups - Close Triceps Position'],
  ['Chest Dips', 'Dips - Chest Version'],
  ['Dumbbell Pullover', 'Straight-Arm Dumbbell Pullover'],
  // Back
  ['Deadlift', 'Barbell Deadlift'],
  ['Conventional Deadlift', 'Barbell Deadlift'],
  ['Romanian Deadlift', 'Romanian Deadlift'],
  ['RDL', 'Romanian Deadlift'],
  ['Stiff Leg Deadlift', 'Stiff-Legged Barbell Deadlift'],
  ['Sumo Deadlift', 'Sumo Deadlift'],
  ['Hex Bar Deadlift', 'Trap Bar Deadlift'],
  ['Trap Bar Deadlift', 'Trap Bar Deadlift'],
  ['Rack Pull', 'Rack Pulls'],
  ['Pull Up', 'Pullups'],
  ['Pull-ups', 'Pullups'],
  ['Chin Up', 'Chin-Up'],
  ['Weighted Pull Up', 'Weighted Pull Ups'],
  ['Barbell Row', 'Bent Over Barbell Row'],
  ['Bent Over Row', 'Bent Over Barbell Row'],
  ['Pendlay Row', 'Bent Over Barbell Row'],
  ['Dumbbell Row', 'One-Arm Dumbbell Row'],
  ['Single Arm Dumbbell Row', 'One-Arm Dumbbell Row'],
  ['Chest Supported Row', 'Dumbbell Incline Row'],
  ['Seated Cable Row', 'Seated Cable Rows'],
  ['Cable Row', 'Seated Cable Rows'],
  ['T-Bar Row', 'T-Bar Row with Handle'],
  ['Close Grip Lat Pulldown', 'Close-Grip Front Lat Pulldown'],
  ['Straight Arm Pulldown', 'Straight-Arm Pulldown'],
  ['Inverted Row', 'Inverted Row'],
  ['Australian Pull Up', 'Inverted Row'],
  ['Back Extension', 'Hyperextensions (Back Extensions)'],
  ['Hyperextension', 'Hyperextensions (Back Extensions)'],
  ['Good Morning', 'Good Morning'],
  ['Shrug', 'Barbell Shrug'],
  ['Barbell Shrug', 'Barbell Shrug'],
  ['Dumbbell Shrug', 'Dumbbell Shrug'],
  // Shoulders
  ['Overhead Press', 'Standing Military Press'],
  ['OHP', 'Standing Military Press'],
  ['Military Press', 'Standing Military Press'],
  ['Barbell Overhead Press', 'Standing Military Press'],
  ['Dumbbell Shoulder Press', 'Dumbbell Shoulder Press'],
  ['Seated Dumbbell Shoulder Press', 'Seated Dumbbell Press'],
  ['Machine Shoulder Press', 'Machine Shoulder (Military) Press'],
  ['Arnold Press', 'Arnold Dumbbell Press'],
  ['Lateral Raise', 'Side Lateral Raise'],
  ['Side Raise', 'Side Lateral Raise'],
  ['Cable Lateral Raise', 'Standing Low-Pulley Deltoid Raise'],
  ['Front Raise', 'Front Dumbbell Raise'],
  ['Dumbbell Front Raise', 'Front Dumbbell Raise'],
  ['Rear Delt Fly', 'Reverse Flyes'],
  ['Reverse Fly', 'Reverse Flyes'],
  ['Reverse Pec Deck', 'Reverse Machine Flyes'],
  ['Face Pull', 'Face Pull'],
  // Arms
  ['Bicep Curl', 'Dumbbell Bicep Curl'],
  ['Barbell Curl', 'Barbell Curl'],
  ['EZ Bar Curl', 'EZ-Bar Curl'],
  ['Hammer Curl', 'Hammer Curls'],
  ['Preacher Curl', 'Preacher Curl'],
  ['Concentration Curl', 'Concentration Curls'],
  ['Incline Dumbbell Curl', 'Incline Dumbbell Curl'],
  ['Cable Curl', 'Standing Biceps Cable Curl'],
  ['Reverse Curl', 'Reverse Barbell Curl'],
  ['Wrist Curl', 'Seated Palm-Up Barbell Wrist Curl'],
  ['Tricep Pushdown', 'Triceps Pushdown'],
  ['Rope Pushdown', 'Triceps Pushdown - Rope Attachment'],
  ['Skull Crusher', 'EZ-Bar Skullcrusher'],
  ['Skullcrushers', 'EZ-Bar Skullcrusher'],
  ['Overhead Tricep Extension', 'Standing Dumbbell Triceps Extension'],
  ['Tricep Kickback', 'Tricep Dumbbell Kickback'],
  ['Dips', 'Dips - Triceps Version'],
  ['Tricep Dips', 'Dips - Triceps Version'],
  ['Bench Dips', 'Bench Dips'],
  // Legs and glutes
  ['Squat', 'Barbell Squat'],
  ['Back Squat', 'Barbell Squat'],
  ['Barbell Back Squat', 'Barbell Squat'],
  ['Front Squat', 'Front Barbell Squat'],
  ['Goblet Squat', 'Goblet Squat'],
  ['Air Squat', 'Bodyweight Squat'],
  ['Jump Squat', 'Freehand Jump Squat'],
  ['Hack Squat', 'Hack Squat'],
  ['Smith Machine Squat', 'Smith Machine Squat'],
  ['Bulgarian Split Squat', 'Split Squat with Dumbbells'],
  ['Lunges', 'Dumbbell Lunges'],
  ['Walking Lunge', 'Barbell Walking Lunge'],
  ['Reverse Lunge', 'Dumbbell Rear Lunge'],
  ['Step Up', 'Dumbbell Step Ups'],
  ['Leg Extension', 'Leg Extensions'],
  ['Leg Curl', 'Lying Leg Curls'],
  ['Lying Leg Curl', 'Lying Leg Curls'],
  ['Hamstring Curl', 'Lying Leg Curls'],
  ['Seated Leg Curl', 'Seated Leg Curl'],
  ['Nordic Curl', 'Natural Glute Ham Raise'],
  ['Hip Thrust', 'Barbell Hip Thrust'],
  ['Glute Bridge', 'Butt Lift (Bridge)'],
  ['Glute Kickback', 'Glute Kickback'],
  ['Cable Kickback', 'One-Legged Cable Kickback'],
  ['Hip Abduction Machine', 'Thigh Abductor'],
  ['Hip Adduction Machine', 'Thigh Adductor'],
  ['Calf Raise', 'Standing Calf Raises'],
  ['Standing Calf Raise', 'Standing Calf Raises'],
  ['Seated Calf Raise', 'Seated Calf Raise'],
  // Core
  ['Plank', 'Plank'],
  ['Side Plank', 'Side Bridge'],
  ['Crunch', 'Crunches'],
  ['Sit Up', 'Sit-Up'],
  ['Bicycle Crunch', 'Air Bike'],
  ['Cable Crunch', 'Cable Crunch'],
  ['Russian Twist', 'Russian Twist'],
  ['Ab Wheel', 'Ab Roller'],
  ['Ab Wheel Rollout', 'Ab Roller'],
  ['Leg Raise', 'Flat Bench Lying Leg Raise'],
  ['Lying Leg Raise', 'Flat Bench Lying Leg Raise'],
  ['Dead Bug', 'Dead Bug'],
  ['Mountain Climbers', 'Mountain Climbers'],
  ['Wood Chop', 'Standing Cable Wood Chop'],
  ['Pallof Press', 'Pallof Press'],
  // Full body, conditioning
  ['Kettlebell Swing', 'One-Arm Kettlebell Swings'],
  ['Turkish Get Up', 'Kettlebell Turkish Get-Up (Lunge style)'],
  ['Box Jump', 'Front Box Jump'],
  ['Farmers Carry', "Farmer's Walk"],
  ['Battle Ropes', 'Battling Ropes'],
  ['Jump Rope', 'Rope Jumping'],
  ['Skipping', 'Rope Jumping'],
  ['Power Clean', 'Power Clean'],
  ['Clean and Jerk', 'Clean and Jerk'],
  ['Push Press', 'Push Press'],
  ['Sled Push', 'Sled Push'],
  ['Treadmill', 'Running, Treadmill'],
  ['Rowing Machine', 'Rowing, Stationary'],
  ['Exercise Bike', 'Bicycling, Stationary'],
];

const CASES = [...TRAINER_APP, ...COMMON];

describe('common gym names find the library exercise first (real library)', () => {
  it('has at least 100 cases and every expected name is in the library', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(100);
    const names = new Set(LIBRARY.map((r) => r.name));
    expect(LIBRARY.length).toBe(886);
    expect(CASES.map(([, e]) => e).filter((e) => !names.has(e))).toEqual([]);
  });

  it.each(CASES)('%s -> %s', (query, expected) => {
    expect(top(query)).toBe(expected);
  });

  // The 10 CalTracker extras (scripts/caltracker-extra-exercises.json) find themselves.
  it.each(LIBRARY_EXTRAS)('%s finds itself', (name) => {
    expect(top(name)).toBe(name);
  });
});

describe('the other-names list', () => {
  it('only names exercises that are in the library', () => {
    const names = new Set(LIBRARY.map((r) => r.name));
    expect(Object.keys(EXERCISE_OTHER_NAMES).filter((n) => !names.has(n))).toEqual([]);
  });

  it('never lists the same other name for two exercises, or an exercise under its own name', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const [name, others] of Object.entries(EXERCISE_OTHER_NAMES)) {
      for (const o of others) {
        const n = normalizeSearchText(o);
        if (n === normalizeSearchText(name)) clashes.push(`${name}: lists itself`);
        const prev = seen.get(n);
        if (prev !== undefined) clashes.push(`${o}: ${prev} and ${name}`);
        seen.set(n, name);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe('how other names behave in search', () => {
  const row = (name: string, o: Partial<ExerciseIndexRow> = {}): ExerciseIndexRow => ({
    id: name,
    name,
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: null,
    category: 'strength',
    trackingType: 'weight_reps',
    source: 'builtin',
    imagePath: null,
    ...o,
  });
  const idx = buildExerciseIndex([
    row('Side Lateral Raise', { equipment: 'dumbbell', primaryMuscles: ['shoulders'] }),
    row('Front Dumbbell Raise', { equipment: 'dumbbell', primaryMuscles: ['shoulders'] }),
    row('Dumbbell Flyes', { equipment: 'dumbbell', primaryMuscles: ['chest'], id: 'custom-flyes', source: 'custom' }),
  ]);
  const search = (q: string) => searchExercises(idx, q, NO_FILTERS, NO_BOOSTS);

  it('a whole other name is a tier 1 match, with nothing highlighted in the real name', () => {
    const h = search('dumbbell lateral raise');
    expect(h[0]?.row.name).toBe('Side Lateral Raise');
    expect(h[0]?.tier).toBe(1);
    expect(h[0]?.highlight).toEqual([]);
  });

  it('a typo in an other name still matches', () => {
    expect(search('dumbell laterl raise')[0]?.row.name).toBe('Side Lateral Raise');
  });

  it('lists each exercise once', () => {
    const ids = search('raise').map((h) => h.row.id);
    expect(new Set(ids).size).toBe(ids.length);
    const all = search('').map((h) => h.row.id);
    expect(all).toHaveLength(3);
  });

  it('a custom exercise with a library name does not get the library other names', () => {
    // It may still match word by word ("chest" is its muscle), but never as a whole-name match.
    const h = search('dumbbell chest fly').find((x) => x.row.id === 'custom-flyes');
    expect(h === undefined || h.tier > 1).toBe(true);
  });
});
