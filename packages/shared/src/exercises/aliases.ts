/**
 * Search shorthand, written as `alias → expansion`. Both sides are lower case words.
 * Plain data: adding an entry is a one-line change.
 */
export const EXERCISE_ALIASES: Readonly<Record<string, string>> = {
  // Equipment
  db: 'dumbbell',
  dbs: 'dumbbell',
  bb: 'barbell',
  kb: 'kettlebell',
  ez: 'ez bar',
  smith: 'smith machine',
  bw: 'bodyweight',
  // Lifts
  ohp: 'overhead press',
  rdl: 'romanian deadlift',
  sldl: 'stiff legged deadlift',
  bss: 'bulgarian split squat',
  pullup: 'pull up',
  chinup: 'chin up',
  pushup: 'push up',
  situp: 'sit up',
  tbar: 't bar',
  // Muscles
  sl: 'single leg',
  lat: 'latissimus',
  lats: 'latissimus',
  tri: 'triceps',
  tris: 'triceps',
  bi: 'biceps',
  bis: 'biceps',
  quad: 'quadriceps',
  quads: 'quadriceps',
  ham: 'hamstrings',
  hammy: 'hamstrings',
  glute: 'glutes',
  delt: 'shoulders',
  delts: 'shoulders',
  trap: 'traps',
  pec: 'chest',
  pecs: 'chest',
  ab: 'abdominals',
  abs: 'abdominals',
  calf: 'calves',
  // Movements
  inc: 'incline',
  dec: 'decline',
  ext: 'extension',
  'ext.': 'extension',
};

/**
 * Words in an exercise name that people also call something else. A name word listed here also
 * answers to the other word ("Military Press" is the overhead press).
 */
export const EXERCISE_NAME_SYNONYMS: Readonly<Record<string, string>> = {
  military: 'overhead',
};
