import type { MuscleId } from '../anatomy/muscles';

/**
 * Findings → possible contributors (step 2, board AS4). For each checkpoint the coach can rate, the muscle groups that
 * MAY be overactive / short or underactive / weak, the things worth checking first, and the built-in corrective
 * exercises the evidence draft recommends. This is the coach's starting hypothesis, never a diagnosis: every mark is
 * shown as "possibly" and the coach confirms, rejects or changes it.
 *
 * Source: the evidence draft (scratchpad assessment/content.json, 2026-11-20, `compensations`), mapped from its 37
 * muscles onto the 22 muscle groups of the shared catalogue (anatomy/muscles.ts) with CONTENT_MUSCLE_MAP. A muscle that
 * the draft lists as both over and under once mapped (outer vs inner hamstrings, say) is left off both lists and named
 * in `alsoConsider` instead. Muscles with no map region (serratus anterior, foot muscles, upper-back extensors) are
 * named in `alsoConsider` too.
 *
 * Rules marked `needsReview` were drafted for step 2 (checkpoints the draft has no table for: the three new tests,
 * shoulder hike, knees bow out, overhead-squat head forward) and still need Luis's sign-off, like the rest of the list.
 * Posture checkpoints (record-only) have no rules on purpose: posture is never linked to muscles automatically; the
 * coach can link one by hand ("+ Add muscle", from a finding).
 */

/** How the 37 muscles of the evidence draft land on the catalogue (null: no region on the map). */
export const CONTENT_MUSCLE_MAP: Readonly<Record<string, MuscleId | null>> = {
  gastrocnemius: 'calves',
  soleus: 'calves',
  tibialis_anterior: 'shins',
  tibialis_posterior: 'shins',
  fibularis: 'shins',
  foot_intrinsics: null,
  hip_adductors: 'adductors',
  tfl: 'tfl',
  gluteus_maximus: 'glute_max',
  gluteus_medius: 'glute_medius',
  // The deep hip rotators sit under glute max; the map has no region of their own.
  hip_external_rotators: 'glute_max',
  hip_flexors: 'hip_flexors',
  rectus_femoris: 'quads',
  quadriceps: 'quads',
  hamstrings_medial: 'hamstrings',
  biceps_femoris: 'hamstrings',
  erector_spinae: 'lower_back',
  quadratus_lumborum: 'lower_back',
  rectus_abdominis: 'abs',
  obliques: 'obliques',
  transversus_abdominis: 'abs',
  latissimus_dorsi: 'lats',
  teres_major: 'lats',
  pectoralis_major: 'chest',
  pectoralis_minor: 'chest',
  upper_trapezius: 'upper_traps',
  middle_trapezius: 'mid_lower_traps',
  lower_trapezius: 'mid_lower_traps',
  rhomboids: 'mid_lower_traps',
  serratus_anterior: null,
  levator_scapulae: 'upper_traps',
  posterior_cuff: 'rotator_cuff',
  posterior_deltoid: 'shoulders',
  thoracic_extensors: null,
  deep_neck_flexors: 'neck',
  upper_neck_extensors: 'neck',
  sternocleidomastoid: 'neck',
};

/** How strong the support is (content.json evidence_scale). */
export type EvidenceLevel = 'strong' | 'moderate' | 'limited' | 'expert_opinion';

export const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  strong: 'Strong evidence',
  moderate: 'Moderate evidence',
  limited: 'Limited evidence',
  expert_opinion: 'Expert opinion',
};

/** "Also check": things worth checking before trusting the muscle guess (board AS4). Ids are stable. */
export const ALSO_CHECKS = {
  ankle_mobility: 'Ankle mobility',
  upper_back_mobility: 'Upper-back mobility',
  hip_rotation: 'Hip rotation range',
  trunk_control: 'Trunk control',
  hands_on_hips: 'Hands-on-hips retest',
  hamstring_length: 'Hamstring length (passive leg raise)',
  hip_flexor_length: 'Hip flexor length (Thomas test)',
  foot_posture: 'Foot posture and shoes',
  pain_history: 'Pain or old injuries',
  squat_depth: 'Depth where rounding starts',
} as const;
export type AlsoCheckId = keyof typeof ALSO_CHECKS;
export const ALSO_CHECK_IDS = Object.keys(ALSO_CHECKS) as AlsoCheckId[];

export type FindingRule = {
  over: readonly MuscleId[];
  under: readonly MuscleId[];
  /** Possible contributors with no map region, or listed both ways: named, never marked. */
  alsoConsider: readonly string[];
  checks: readonly AlsoCheckId[];
  /** Built-in corrective keys (correctives.ts), best first. */
  exercises: readonly string[];
  evidence: EvidenceLevel;
  /**
   * 'opposite': the muscles are on the other side from the one rated. The straight-leg raise is rated on the raised leg,
   * but "the other leg lifts" points at the tight hip flexor (and weak glute) of the leg that stays down.
   */
  side?: 'opposite';
  needsReview?: true;
};

const rule = (r: FindingRule): FindingRule => r;

const KNEE_VALGUS = rule({
  over: ['adductors', 'tfl', 'calves', 'hamstrings'],
  under: ['glute_medius', 'glute_max'],
  alsoConsider: ['Deep hip rotators (under glute max)'],
  checks: ['ankle_mobility'],
  exercises: ['knee_to_wall_ankle_mobilization', 'banded_lateral_walk', 'side_lying_hip_abduction', 'single_leg_glute_bridge', 'goblet_squat', 'step_down', 'standing_calf_stretch', 'foam_roll_tfl', 'standing_tfl_stretch'],
  evidence: 'moderate',
});

const TRUNK_SAG = rule({
  over: ['hip_flexors', 'lower_back'],
  under: ['abs', 'obliques', 'glute_max'],
  alsoConsider: [],
  checks: ['trunk_control'],
  exercises: ['incline_push_up', 'front_plank', 'dead_bug', 'glute_bridge', 'bird_dog', 'childs_pose'],
  evidence: 'expert_opinion',
});

const HEAD_FORWARD = rule({
  over: ['upper_traps'],
  under: [],
  alsoConsider: ['Neck: deep neck flexors (weak) and upper neck extensors (tight)'],
  checks: [],
  exercises: ['chin_tuck', 'front_plank', 'incline_push_up', 'upper_trap_stretch'],
  evidence: 'limited',
});

const ASLR_DOWN_LEG = rule({
  over: ['hip_flexors', 'quads'],
  under: ['glute_max', 'abs', 'obliques'],
  alsoConsider: [],
  checks: ['hip_flexor_length'],
  exercises: ['half_kneeling_hip_flexor_stretch', 'active_leg_lowering', 'glute_bridge', 'dead_bug'],
  evidence: 'limited',
  side: 'opposite',
});

const SHOULDER_HIKE = rule({
  over: ['upper_traps'],
  under: ['mid_lower_traps'],
  alsoConsider: ['Serratus anterior'],
  checks: [],
  exercises: ['prone_y_raise', 'wall_slide', 'side_lying_external_rotation', 'upper_trap_stretch'],
  evidence: 'limited',
  needsReview: true,
});

const SLHH_GLUTE_MED = rule({
  over: ['tfl', 'hip_flexors'],
  under: ['glute_medius'],
  alsoConsider: [],
  checks: ['trunk_control'],
  exercises: ['side_lying_hip_abduction', 'clamshell', 'side_plank', 'banded_lateral_walk', 'foam_roll_tfl'],
  evidence: 'limited',
  needsReview: true,
});

const HIP_IR = rule({
  over: ['glute_max'],
  under: [],
  alsoConsider: ['Deep hip rotators and hip joint shape'],
  checks: ['hip_rotation'],
  exercises: ['quadruped_rock_back', 'figure_four_stretch', 'foam_roll_glutes'],
  evidence: 'expert_opinion',
  needsReview: true,
});

/** Checkpoint id (step 1's library, e.g. `ohs.knee_valgus`) → its rule. Checkpoints not listed suggest nothing. */
export const FINDING_RULES: Readonly<Record<string, FindingRule>> = {
  // Overhead squat (content: ohs_*)
  'ohs.knee_valgus': KNEE_VALGUS,
  'ohs.feet_turn_out': rule({
    over: ['calves'],
    under: ['glute_medius', 'glute_max'],
    alsoConsider: ['Hamstrings: outer (tight) vs inner (weak)'],
    checks: ['ankle_mobility'],
    exercises: ['knee_to_wall_ankle_mobilization', 'bent_knee_calf_stretch', 'standing_calf_stretch', 'glute_bridge', 'goblet_squat'],
    evidence: 'expert_opinion',
  }),
  'ohs.heel_rise': rule({
    over: ['calves'],
    under: ['shins'],
    alsoConsider: [],
    checks: ['ankle_mobility'],
    exercises: ['knee_to_wall_ankle_mobilization', 'bent_knee_calf_stretch', 'standing_calf_stretch', 'heel_elevated_goblet_squat', 'foam_roll_calves', 'standing_calf_raise'],
    evidence: 'moderate',
  }),
  'ohs.knee_varus': rule({
    over: ['tfl'],
    under: ['adductors'],
    alsoConsider: ['Deep hip rotators (piriformis)'],
    checks: ['foot_posture'],
    exercises: ['half_kneeling_adductor_stretch', 'goblet_squat', 'split_squat'],
    evidence: 'expert_opinion',
    needsReview: true,
  }),
  'ohs.weight_shift': rule({
    over: ['adductors', 'tfl'],
    under: ['glute_medius', 'glute_max'],
    alsoConsider: [],
    checks: ['pain_history'],
    exercises: ['split_squat', 'step_down', 'single_leg_rdl', 'side_lying_hip_abduction', 'goblet_squat', 'standing_tfl_stretch'],
    evidence: 'expert_opinion',
  }),
  'ohs.forward_lean': rule({
    over: ['calves', 'hip_flexors'],
    under: ['glute_max', 'lower_back', 'shins'],
    alsoConsider: [],
    checks: ['ankle_mobility'],
    exercises: ['goblet_squat', 'knee_to_wall_ankle_mobilization', 'half_kneeling_hip_flexor_stretch', 'hip_thrust', 'box_squat'],
    evidence: 'limited',
  }),
  'ohs.low_back_arch': rule({
    over: ['hip_flexors', 'lower_back', 'lats'],
    under: ['glute_max', 'hamstrings', 'abs'],
    alsoConsider: [],
    checks: ['hands_on_hips'],
    exercises: ['dead_bug', 'half_kneeling_hip_flexor_stretch', 'glute_bridge', 'front_plank', 'kneeling_lat_stretch', 'wall_slide', 'childs_pose', 'cat_cow'],
    evidence: 'expert_opinion',
  }),
  'ohs.arms_fall_forward': rule({
    over: ['lats', 'chest'],
    under: ['mid_lower_traps', 'rotator_cuff'],
    alsoConsider: [],
    checks: ['upper_back_mobility'],
    exercises: ['thoracic_extension_foam_roller', 'kneeling_lat_stretch', 'wall_slide', 'prone_y_raise', 'doorway_pec_stretch', 'foam_roll_lats'],
    evidence: 'limited',
  }),
  'ohs.head_forward': { ...HEAD_FORWARD, needsReview: true },

  // Single-leg squat (content: sls_*). The side is the standing leg.
  'sls.knee_valgus': rule({
    over: ['adductors', 'tfl'],
    under: ['glute_medius', 'glute_max'],
    alsoConsider: ['Deep hip rotators (under glute max)'],
    checks: ['ankle_mobility'],
    exercises: ['step_down', 'banded_lateral_walk', 'side_lying_hip_abduction', 'single_leg_glute_bridge', 'split_squat', 'knee_to_wall_ankle_mobilization', 'foam_roll_tfl', 'standing_tfl_stretch'],
    evidence: 'moderate',
  }),
  'sls.pelvic_drop': rule({
    over: ['adductors', 'lower_back'],
    under: ['glute_medius'],
    alsoConsider: [],
    checks: [],
    exercises: ['side_lying_hip_abduction', 'side_plank', 'single_leg_glute_bridge', 'step_down', 'banded_lateral_walk', 'childs_pose'],
    evidence: 'moderate',
  }),
  'sls.trunk_lateral_lean': rule({
    over: ['lower_back'],
    under: ['glute_medius', 'obliques'],
    alsoConsider: [],
    checks: ['trunk_control'],
    exercises: ['side_plank', 'suitcase_carry', 'side_lying_hip_abduction', 'step_down', 'childs_pose'],
    evidence: 'limited',
  }),
  'sls.foot_collapse': rule({
    over: [],
    under: ['shins', 'glute_medius'],
    alsoConsider: ['Foot muscles'],
    checks: ['foot_posture'],
    exercises: ['short_foot', 'single_leg_balance', 'y_balance_reach', 'standing_calf_raise'],
    evidence: 'limited',
  }),
  'sls.loses_balance': rule({
    over: [],
    under: ['shins', 'glute_medius'],
    alsoConsider: ['Foot muscles'],
    checks: [],
    exercises: ['single_leg_balance', 'y_balance_reach', 'short_foot', 'standing_calf_raise'],
    evidence: 'limited',
  }),

  // Push-up (content: pu_*)
  'pu.lumbar_sag': TRUNK_SAG,
  'pu.hip_pike': TRUNK_SAG,
  'pu.scapular_winging': rule({
    over: ['chest'],
    under: ['mid_lower_traps'],
    alsoConsider: ['Serratus anterior'],
    checks: [],
    exercises: ['push_up_plus', 'serratus_punch', 'wall_slide', 'prone_y_raise', 'incline_push_up'],
    evidence: 'limited',
  }),
  'pu.scapular_elevation': rule({
    over: ['upper_traps'],
    under: ['mid_lower_traps'],
    alsoConsider: ['Serratus anterior'],
    checks: [],
    exercises: ['side_lying_external_rotation', 'prone_t_raise', 'prone_y_raise', 'push_up_plus', 'incline_push_up', 'upper_trap_stretch'],
    evidence: 'limited',
  }),
  'pu.head_forward': HEAD_FORWARD,

  // Shoulder mobility: the shoulder hike drafted for step 2 (the draft scores the reach itself, which step 1 measures).
  'shm.shoulder_hike': SHOULDER_HIKE,

  // Straight-leg raise (content: aslr_down_leg)
  'aslr.down_leg_moves': ASLR_DOWN_LEG,
  'aslr.pelvis_moves': ASLR_DOWN_LEG,

  // Side-lying hip hold (new test, drafted)
  'slhh.hip_rolls_back': { ...SLHH_GLUTE_MED, over: [] },
  'slhh.leg_drifts_forward': SLHH_GLUTE_MED,
  'slhh.hip_hikes': rule({
    over: ['lower_back'],
    under: ['glute_medius'],
    alsoConsider: [],
    checks: ['trunk_control'],
    exercises: ['side_lying_hip_abduction', 'side_plank', 'clamshell', 'childs_pose'],
    evidence: 'limited',
    needsReview: true,
  }),
  'slhh.toes_turn_up': { ...SLHH_GLUTE_MED, over: ['hip_flexors'] },

  // Wall shoulder flexion (new test, drafted; content: sh_limited_overhead / sh_lumbar_compensation)
  'wsf.low_back_arch': rule({
    over: ['lats', 'lower_back'],
    under: ['abs', 'obliques'],
    alsoConsider: [],
    checks: ['upper_back_mobility'],
    exercises: ['dead_bug', 'wall_slide', 'kneeling_lat_stretch', 'front_plank', 'childs_pose'],
    evidence: 'expert_opinion',
    needsReview: true,
  }),
  'wsf.elbow_bend': rule({
    over: ['lats'],
    under: [],
    alsoConsider: [],
    checks: ['upper_back_mobility'],
    exercises: ['kneeling_lat_stretch', 'foam_roll_lats', 'thoracic_extension_foam_roller'],
    evidence: 'expert_opinion',
    needsReview: true,
  }),
  'wsf.arm_drifts_out': rule({
    over: ['lats', 'chest'],
    under: ['mid_lower_traps'],
    alsoConsider: ['Serratus anterior'],
    checks: ['upper_back_mobility'],
    exercises: ['kneeling_lat_stretch', 'doorway_pec_stretch', 'wall_slide', 'prone_y_raise'],
    evidence: 'limited',
    needsReview: true,
  }),
  'wsf.shoulder_hike': SHOULDER_HIKE,

  // Seated hip internal rotation (new test, drafted)
  'hir.trunk_lean': HIP_IR,
  'hir.thigh_moves': HIP_IR,
};

/** The rule for a checkpoint, or undefined (record-only posture, or a checkpoint with nothing to suggest). */
export function findingRule(checkpointId: string): FindingRule | undefined {
  return Object.prototype.hasOwnProperty.call(FINDING_RULES, checkpointId) ? FINDING_RULES[checkpointId] : undefined;
}
