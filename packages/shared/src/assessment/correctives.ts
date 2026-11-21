import { isMuscleId, regionSides, type MuscleId } from '../anatomy/muscles';
import type { EvidenceLevel } from './rules';

/**
 * Corrective exercises (step 2, boards AS5 / AS8). Each one is tagged to muscle groups (and sides) and to a direction:
 * `under` = activate / strengthen a possibly underactive muscle, `over` = release / stretch a possibly overactive one.
 *
 * The coach's own corrective exercises live in the database (corrective_exercises, tagged rows of the exercise
 * library). The built-in defaults below come from the evidence draft (content.json `exercises`) and are offered after
 * the coach's own, with their evidence level. A built-in is only offered once its exercise is in the exercise library:
 * `libraryName` is the library exercise it points at, found by name (case-insensitive) among the built-in exercises.
 * Most already exist (free-exercise-db); the rest are added by scripts/caltracker-extra-exercises.json and appear after
 * the next `import-exercises` run.
 */

export const CORRECTIVE_DIRECTIONS = ['under', 'over'] as const;
export type CorrectiveDirection = (typeof CORRECTIVE_DIRECTIONS)[number];

export const DIRECTION_LABELS: Record<CorrectiveDirection, { short: string; long: string; action: string }> = {
  under: { short: 'Under', long: 'Underactive', action: 'strengthen' },
  over: { short: 'Over', long: 'Overactive', action: 'release / stretch' },
};

/** A default dose: sets of reps or of seconds, maybe each side. Reps and seconds are both null for a carry. */
export type CorrectiveDose = { sets: number; reps: number | null; seconds: number | null; eachSide: boolean };

export const DOSE_LIMITS = { sets: 20, reps: 100, seconds: 600 } as const;

/** "2 × 5 each side", "2 × 30 s", "60 s each side", "3 sets". */
export function doseText(d: CorrectiveDose): string {
  const side = d.eachSide ? ' each side' : '';
  const amount = d.reps !== null ? String(d.reps) : d.seconds !== null ? `${d.seconds} s` : null;
  if (amount === null) return `${d.sets} ${d.sets === 1 ? 'set' : 'sets'}${side}`;
  return d.sets === 1 ? `${amount}${side}` : `${d.sets} × ${amount}${side}`;
}

export type BuiltinCorrective = {
  /** Stable key (content.json exercise id). */
  key: string;
  /** The built-in library exercise it points at (exercises.name, matched case-insensitively). */
  libraryName: string;
  direction: CorrectiveDirection;
  muscles: readonly MuscleId[];
  dose: CorrectiveDose;
  evidence: EvidenceLevel;
  /** Added for step 2 (not in the evidence draft) for a muscle that had no built-in: Luis to confirm. */
  needsReview?: true;
};

const reps = (sets: number, n: number, eachSide = false): CorrectiveDose => ({ sets, reps: n, seconds: null, eachSide });
const secs = (sets: number, n: number, eachSide = false): CorrectiveDose => ({ sets, reps: null, seconds: n, eachSide });

const c = (key: string, libraryName: string, direction: CorrectiveDirection, muscles: MuscleId[], dose: CorrectiveDose, evidence: EvidenceLevel): BuiltinCorrective => ({
  key,
  libraryName,
  direction,
  muscles,
  dose,
  evidence,
});
const review = (b: BuiltinCorrective): BuiltinCorrective => ({ ...b, needsReview: true });

/** The built-in defaults. Doses are the low end of the draft's ranges ("2–3 × 30 s" → 2 × 30 s). */
export const BUILTIN_CORRECTIVES: readonly BuiltinCorrective[] = [
  // Release / stretch (possibly overactive)
  c('knee_to_wall_ankle_mobilization', 'Knee-to-Wall Ankle Mobilization', 'over', ['calves'], reps(2, 10, true), 'limited'),
  c('standing_calf_stretch', 'Calf Stretch Hands Against Wall', 'over', ['calves'], secs(2, 30, true), 'moderate'),
  c('bent_knee_calf_stretch', 'Bent-Knee Calf Stretch', 'over', ['calves'], secs(2, 30, true), 'moderate'),
  c('foam_roll_calves', 'Calves-SMR', 'over', ['calves'], secs(1, 60, true), 'moderate'),
  c('half_kneeling_hip_flexor_stretch', 'Kneeling Hip Flexor', 'over', ['hip_flexors', 'quads'], secs(2, 30, true), 'limited'),
  c('half_kneeling_adductor_stretch', 'Half-Kneeling Adductor Stretch', 'over', ['adductors'], secs(2, 30, true), 'expert_opinion'),
  c('supine_hamstring_stretch', 'Supine Hamstring Stretch', 'over', ['hamstrings'], secs(2, 30, true), 'moderate'),
  c('doorway_pec_stretch', 'Doorway Pec Stretch', 'over', ['chest'], secs(2, 30), 'limited'),
  c('kneeling_lat_stretch', 'Kneeling Lat Stretch', 'over', ['lats'], secs(2, 30), 'expert_opinion'),
  c('foam_roll_lats', 'Latissimus Dorsi-SMR', 'over', ['lats'], secs(1, 60, true), 'moderate'),
  c('thoracic_extension_foam_roller', 'Thoracic Extension on Foam Roller', 'over', ['lats', 'chest'], reps(2, 8), 'limited'),
  c('open_book', 'Open Book', 'over', ['chest'], reps(2, 8, true), 'expert_opinion'),
  c('cross_body_stretch', 'Cross-Body Stretch', 'over', ['rotator_cuff', 'shoulders'], secs(3, 30, true), 'moderate'),
  c('sleeper_stretch', 'Sleeper Stretch', 'over', ['rotator_cuff'], secs(3, 30, true), 'limited'),
  // Release / stretch for muscles the draft had no built-in for (TFL, upper traps, low back, glute max): existing
  // free-exercise-db exercises, marked for Luis to confirm.
  review(c('foam_roll_tfl', 'Iliotibial Tract-SMR', 'over', ['tfl'], secs(1, 60, true), 'expert_opinion')),
  review(c('standing_tfl_stretch', 'IT Band and Glute Stretch', 'over', ['tfl', 'glute_max'], secs(2, 30, true), 'expert_opinion')),
  review(c('upper_trap_stretch', 'Side Neck Stretch', 'over', ['upper_traps', 'neck'], secs(2, 30, true), 'expert_opinion')),
  review(c('childs_pose', "Child's Pose", 'over', ['lower_back', 'lats'], secs(2, 30), 'expert_opinion')),
  review(c('cat_cow', 'Cat Stretch', 'over', ['lower_back'], secs(2, 30), 'expert_opinion')),
  review(c('figure_four_stretch', 'Ankle On The Knee', 'over', ['glute_max'], secs(2, 30, true), 'expert_opinion')),
  review(c('foam_roll_glutes', 'Piriformis-SMR', 'over', ['glute_max'], secs(1, 60, true), 'expert_opinion')),
  // Activate / strengthen (possibly underactive)
  c('banded_lateral_walk', 'Banded Lateral Walk', 'under', ['glute_medius', 'glute_max'], reps(3, 10, true), 'moderate'),
  c('side_lying_hip_abduction', 'Side-Lying Hip Abduction', 'under', ['glute_medius'], reps(3, 12, true), 'moderate'),
  c('clamshell', 'Clamshell', 'under', ['glute_medius', 'glute_max'], reps(2, 15, true), 'moderate'),
  c('glute_bridge', 'Glute Bridge', 'under', ['glute_max', 'hamstrings'], reps(3, 12), 'moderate'),
  c('single_leg_glute_bridge', 'Single Leg Glute Bridge', 'under', ['glute_max', 'glute_medius'], reps(3, 8, true), 'moderate'),
  c('hip_thrust', 'Barbell Hip Thrust', 'under', ['glute_max'], reps(3, 8), 'moderate'),
  c('step_down', 'Step-Down', 'under', ['glute_medius', 'glute_max', 'quads'], reps(3, 8, true), 'moderate'),
  c('split_squat', 'Split Squats', 'under', ['quads', 'glute_max', 'adductors'], reps(3, 8, true), 'moderate'),
  c('single_leg_rdl', 'Single-Leg Romanian Deadlift', 'under', ['hamstrings', 'glute_max', 'glute_medius'], reps(3, 8, true), 'moderate'),
  c('romanian_deadlift', 'Romanian Deadlift', 'under', ['hamstrings', 'glute_max', 'lower_back'], reps(3, 8), 'moderate'),
  c('goblet_squat', 'Goblet Squat', 'under', ['quads', 'glute_max'], reps(3, 8), 'expert_opinion'),
  c('box_squat', 'Box Squat', 'under', ['quads', 'glute_max'], reps(3, 8), 'expert_opinion'),
  c('heel_elevated_goblet_squat', 'Heel-Elevated Goblet Squat', 'under', ['quads'], reps(3, 8), 'limited'),
  c('dowel_hip_hinge', 'Dowel Hip Hinge', 'under', ['glute_max', 'hamstrings', 'lower_back'], reps(2, 10), 'expert_opinion'),
  c('quadruped_rock_back', 'Quadruped Rock Back', 'under', ['glute_max', 'lower_back'], reps(2, 10), 'expert_opinion'),
  c('dead_bug', 'Dead Bug', 'under', ['abs', 'obliques'], reps(3, 6, true), 'expert_opinion'),
  c('front_plank', 'Plank', 'under', ['abs', 'obliques'], secs(3, 20), 'limited'),
  c('side_plank', 'Side Bridge', 'under', ['obliques', 'lower_back', 'glute_medius'], secs(3, 20, true), 'moderate'),
  c('bird_dog', 'Bird Dog', 'under', ['lower_back', 'glute_max'], reps(3, 6, true), 'limited'),
  c('suitcase_carry', 'Suitcase Carry', 'under', ['obliques', 'glute_medius'], { sets: 3, reps: null, seconds: null, eachSide: true }, 'expert_opinion'),
  c('active_leg_lowering', 'Active Leg Lowering', 'under', ['hip_flexors', 'abs'], reps(2, 8, true), 'expert_opinion'),
  c('nordic_hamstring_curl', 'Nordic Hamstring Curl', 'under', ['hamstrings'], reps(2, 4), 'moderate'),
  c('standing_calf_raise', 'Standing Calf Raises', 'under', ['calves'], reps(3, 12), 'limited'),
  c('short_foot', 'Short Foot Exercise', 'under', ['shins'], reps(3, 10), 'limited'),
  c('single_leg_balance', 'Single-Leg Balance', 'under', ['shins', 'glute_medius'], secs(3, 30, true), 'expert_opinion'),
  c('y_balance_reach', 'Single-Leg Balance with Reach', 'under', ['glute_medius', 'glute_max', 'quads'], reps(2, 5, true), 'limited'),
  // Serratus anterior has no map region: its exercises sit with the other shoulder-blade muscles (mid/lower traps).
  c('push_up_plus', 'Push-Up Plus', 'under', ['mid_lower_traps'], reps(3, 8), 'moderate'),
  c('serratus_punch', 'Supine Dumbbell Serratus Punch', 'under', ['mid_lower_traps'], reps(3, 12), 'limited'),
  c('wall_slide', 'Wall Slide', 'under', ['mid_lower_traps'], reps(2, 10), 'expert_opinion'),
  c('prone_y_raise', 'Prone Y Raise', 'under', ['mid_lower_traps'], reps(2, 10), 'moderate'),
  c('prone_t_raise', 'Prone T Raise (Thumbs Up)', 'under', ['mid_lower_traps', 'shoulders'], reps(2, 10), 'moderate'),
  c('side_lying_external_rotation', 'Side-Lying External Rotation', 'under', ['rotator_cuff', 'shoulders'], reps(3, 12, true), 'moderate'),
  c('incline_push_up', 'Incline Push-Up', 'under', ['chest'], reps(3, 8), 'expert_opinion'),
  c('half_kneeling_landmine_press', 'Half-Kneeling Landmine Press', 'under', ['chest'], reps(3, 8, true), 'expert_opinion'),
  c('chin_tuck', 'Chin Tuck', 'under', ['neck'], reps(2, 10), 'limited'),
];

const BY_KEY = new Map(BUILTIN_CORRECTIVES.map((b) => [b.key, b]));

export function builtinCorrective(key: string): BuiltinCorrective | undefined {
  return BY_KEY.get(key);
}

/** Lower-cased library names, for one `in (...)` lookup of the built-in exercises they point at. */
export const BUILTIN_CORRECTIVE_NAMES: readonly string[] = BUILTIN_CORRECTIVES.map((b) => b.libraryName);

/** A coach's corrective exercise as the form sends it: direction, muscle tags and default dose. */
export type CorrectiveTagsInput = {
  direction: CorrectiveDirection;
  muscles: { muscleId: string; side: 'L' | 'R' | 'none' }[];
  dose: CorrectiveDose;
};

export const MAX_CORRECTIVE_MUSCLES = 12;

const okInt = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * The form's direction, muscles (each a catalogue muscle on a side it has, at least one, no repeats) and dose (1–20
 * sets; reps or seconds, exactly one), checked; null when anything is off. The database checks again.
 */
export function checkCorrectiveTags(input: unknown): CorrectiveTagsInput | null {
  if (typeof input !== 'object' || input === null) return null;
  const i = input as Record<string, unknown>;
  if (i.direction !== 'under' && i.direction !== 'over') return null;
  if (!Array.isArray(i.muscles) || i.muscles.length === 0 || i.muscles.length > MAX_CORRECTIVE_MUSCLES * 2) return null;
  const seen = new Set<string>();
  const muscles: CorrectiveTagsInput['muscles'] = [];
  for (const raw of i.muscles as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null;
    const m = raw as Record<string, unknown>;
    if (!isMuscleId(m.muscleId) || typeof m.side !== 'string' || !(regionSides(m.muscleId) as readonly string[]).includes(m.side)) return null;
    const key = `${m.muscleId as string}.${m.side}`;
    if (seen.has(key)) return null;
    seen.add(key);
    muscles.push({ muscleId: m.muscleId, side: m.side as 'L' | 'R' | 'none' });
  }
  if (new Set(muscles.map((m) => m.muscleId)).size > MAX_CORRECTIVE_MUSCLES) return null;
  const d = i.dose as Record<string, unknown> | null;
  if (typeof d !== 'object' || d === null) return null;
  if (!okInt(d.sets, 1, DOSE_LIMITS.sets) || typeof d.eachSide !== 'boolean') return null;
  const reps = d.reps === null ? null : okInt(d.reps, 1, DOSE_LIMITS.reps) ? (d.reps as number) : undefined;
  const seconds = d.seconds === null ? null : okInt(d.seconds, 1, DOSE_LIMITS.seconds) ? (d.seconds as number) : undefined;
  // Exactly one of reps or seconds: a dose of just "2 sets" tells the client nothing to do.
  if (reps === undefined || seconds === undefined || (reps === null) === (seconds === null)) return null;
  return { direction: i.direction, muscles, dose: { sets: d.sets as number, reps, seconds, eachSide: d.eachSide } };
}
