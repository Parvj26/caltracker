import type { CheckpointDef, FollowUpDef, MeasureDef, TestDefinition } from './types';

/**
 * The built-in test library, version 1. Content: the evidence-based draft (content.json, 2026-11-20) cut down to what
 * Luis approved on the boards (AS2, AS3): Normal / Slight / Severe judged by how far it goes, shoes on, no rep count.
 * The last three tests (side-lying hip hold, wall shoulder flexion, seated hip internal rotation) are new drafts that
 * Luis asked for and still has to review (`needsReview`).
 *
 * Seeded into public.assessment_test_definitions by migration 20261121000200_assessment_library.sql; a unit test
 * checks the two match. To change a test: add version 2 here AND in a new migration. Never edit version 1: assessments
 * keep a copy of the version they were run with, and Compare joins on the checkpoint ids, so ids are never reused.
 */

const SAME = 'Seen on some reps or small in size';
const MARKED = 'Seen on most reps and clearly visible';

const cp = (id: string, label: string, sided: boolean, slight = SAME, severe = MARKED, finding?: string): CheckpointDef => ({
  id,
  label,
  ...(finding ? { finding } : {}),
  sided,
  guide: { slight, severe },
});

const measure = (m: MeasureDef): MeasureDef => m;
const followUp = (f: FollowUpDef): FollowUpDef => f;

export const BUILTIN_TESTS: readonly TestDefinition[] = [
  {
    key: 'overhead_squat',
    version: 1,
    name: 'Overhead squat',
    summary: 'Front + side · shoes on',
    kind: 'scored',
    steps: ['Shoes on, feet hip-width, toes forward', 'Arms straight overhead, no dowel', 'Squat slowly a few times'],
    views: [
      {
        id: 'front',
        label: 'Front',
        watch: 'Front: feet, knees, hips',
        groups: [
          {
            label: 'Feet',
            checkpoints: [
              cp('ohs.feet_turn_out', 'Turn out', true, 'Toes turn out a little', 'Toes turn clearly out', 'Feet turn out'),
              cp('ohs.heel_rise', 'Heels lift', true, 'Heel lifts a little, weight onto the toes', 'Heel clearly off the floor'),
            ],
          },
          {
            label: 'Knees',
            checkpoints: [
              cp('ohs.knee_valgus', 'Cave in (valgus)', true, 'Knee moves inward but stays over the foot', 'Knee moves inside the big toe', 'Knees cave in'),
              cp('ohs.knee_varus', 'Bow out', true, 'Knee moves a little outside the foot', 'Knee moves outside the little toe', 'Knees bow out'),
            ],
          },
          {
            label: 'Hips',
            checkpoints: [cp('ohs.weight_shift', 'Shift to one side', true, 'Small shift toward this side', 'Clear shift toward this side', 'Shifts to one side')],
          },
        ],
      },
      {
        id: 'side',
        label: 'Side',
        watch: 'Side: trunk, arms, head',
        groups: [
          {
            label: 'Trunk',
            checkpoints: [
              cp('ohs.forward_lean', 'Leans forward', false, 'Trunk a little more forward than the shins', 'Chest drops toward the thighs'),
              cp('ohs.low_back_arch', 'Low back arches', false),
            ],
          },
          {
            label: 'Shoulders',
            checkpoints: [
              cp('ohs.arms_fall_forward', 'Arms fall forward', true, 'Arms drift a little in front of the ears', 'Arms drop well forward of the trunk line'),
            ],
          },
          {
            label: 'Head',
            checkpoints: [cp('ohs.head_forward', 'Pokes forward', false, 'Chin a little forward', 'Chin clearly forward of the chest', 'Head pokes forward')],
          },
        ],
      },
    ],
    measures: [],
    followUps: [
      followUp({
        id: 'ohs.heel_lift_retest',
        label: 'Heel-lift follow-up',
        prompt: 'Squat again with heels on a small lift. Knees and arms:',
        after: 'ohs.heel_rise',
        options: [
          { value: 'better', label: 'Better' },
          { value: 'same', label: 'Same' },
        ],
      }),
    ],
    sources: [
      'Post EG et al. 2017, J Sport Rehabil 26(1):18-23 (overhead squat, knee displacement)',
      'Bell DR, Padua DA, Clark MA 2008, Arch Phys Med Rehabil 89(7):1323-8 (medial knee displacement)',
      'Macrum E et al. 2012, J Sport Rehabil 21(2):144-50 (ankle range and knee valgus)',
    ],
  },
  {
    key: 'single_leg_squat',
    version: 1,
    name: 'Single-leg squat',
    summary: 'Each leg · front',
    kind: 'scored',
    steps: ['Stand on one leg, arms crossed', 'Squat to about a quarter squat, slowly, a few times', 'Then the other leg'],
    views: [
      {
        id: 'front',
        label: 'Front',
        watch: 'Front: trunk, hips, knee, foot',
        groups: [
          {
            label: 'Knees',
            checkpoints: [cp('sls.knee_valgus', 'Knee caves in', true, 'Knee moves inward but stays over the foot', 'Knee moves inside the big toe')],
          },
          {
            label: 'Hips',
            checkpoints: [cp('sls.pelvic_drop', 'Opposite hip drops', true, 'Opposite hip drops a little', 'Opposite hip drops clearly')],
          },
          {
            label: 'Trunk',
            checkpoints: [cp('sls.trunk_lateral_lean', 'Trunk leans sideways', true, 'Small lean over the standing leg', 'Clear lean over the standing leg')],
          },
          {
            label: 'Feet',
            checkpoints: [
              cp('sls.foot_collapse', 'Arch collapses', true),
              cp('sls.loses_balance', 'Loses balance', true, 'Wobbles but stays up', 'Foot touches down or grabs for support'),
            ],
          },
        ],
      },
    ],
    measures: [],
    followUps: [],
    sources: ['Crossley KM et al. 2011, Am J Sports Med 39(4):866-73 (single-leg squat rating)'],
  },
  {
    key: 'push_up',
    version: 1,
    name: 'Push-up',
    summary: 'Side view · note the type done',
    kind: 'scored',
    steps: ['Side view', 'A few slow reps'],
    views: [
      {
        id: 'side',
        label: 'Side',
        watch: 'Side: trunk, shoulders, head',
        groups: [
          {
            label: 'Trunk',
            checkpoints: [cp('pu.lumbar_sag', 'Hips sag', false), cp('pu.hip_pike', 'Hips pike up', false)],
          },
          {
            label: 'Shoulders',
            checkpoints: [
              cp('pu.scapular_winging', 'Shoulder blades wing', true, 'Slight lift, not on every rep', 'Clear lift on most reps'),
              cp('pu.scapular_elevation', 'Shoulders shrug', true),
            ],
          },
          {
            label: 'Head',
            checkpoints: [cp('pu.head_forward', 'Chin pokes forward', false)],
          },
        ],
      },
    ],
    measures: [],
    followUps: [],
    typeDone: { label: 'Type done', placeholder: 'Floor, incline (hands on bench) or knees' },
    sources: ['McClure P et al. 2009, J Athl Train 44(2):160-4 (scapular dyskinesis, visual rating)'],
  },
  {
    key: 'shoulder_mobility',
    version: 1,
    name: 'Shoulder mobility',
    summary: 'Measure each side',
    kind: 'scored',
    steps: ['Fists behind back, one from above, one from below', 'Measure the gap', 'Swap arms'],
    views: [
      {
        id: 'back',
        label: 'Back',
        watch: 'Watch: shoulder hiking, discomfort',
        groups: [
          {
            label: 'Also seen',
            checkpoints: [cp('shm.shoulder_hike', 'Shoulder hikes up', true, 'Shoulder lifts a little', 'Shoulder lifts clearly toward the ear')],
          },
        ],
      },
    ],
    measures: [
      measure({ id: 'shm.reach_gap', label: 'Shoulder mobility gap · top hand', unit: 'cm', sided: true, higherIsBetter: false, min: 0, max: 60 }),
    ],
    followUps: [],
    sources: ['Cook G et al. 2014, Int J Sports Phys Ther 9(3):396-409 (FMS shoulder mobility)'],
  },
  {
    key: 'active_straight_leg_raise',
    version: 1,
    name: 'Straight-leg raise',
    summary: 'Measure each side',
    kind: 'scored',
    steps: ['Lie on back, legs straight', 'Lift one straight leg as high as you can', 'Measure the angle, then swap'],
    views: [
      {
        id: 'side',
        label: 'Side',
        watch: 'Side: the other leg and the pelvis',
        groups: [
          {
            label: 'Also seen',
            checkpoints: [
              cp('aslr.down_leg_moves', 'Other leg lifts or bends', true, 'Other leg lifts or bends a little', 'Other leg clearly lifts, bends or rolls out'),
              cp('aslr.pelvis_moves', 'Pelvis tilts or rotates', true),
            ],
          },
        ],
      },
    ],
    measures: [measure({ id: 'aslr.angle', label: 'Straight-leg raise', unit: 'deg', sided: true, higherIsBetter: true, min: 0, max: 120 })],
    followUps: [],
    sources: ['Cook G et al. 2014, Int J Sports Phys Ther 9(3):396-409 (FMS active straight-leg raise)'],
  },
  {
    key: 'static_posture',
    version: 1,
    name: 'Posture',
    summary: 'Checklist · record only',
    kind: 'record_only',
    steps: ['Relaxed standing, front and side'],
    views: [
      {
        id: 'side',
        label: 'Side',
        watch: 'Relaxed standing, front and side',
        groups: [
          {
            label: 'Checklist · record only',
            checkpoints: [
              cp('posture.head_forward', 'Head forward', false, 'Ear a little in front of the shoulder', 'Ear clearly in front of the shoulder'),
              cp('posture.rounded_shoulders', 'Rounded shoulders', true, 'A little forward', 'Clearly forward'),
              cp('posture.shoulder_higher', 'One shoulder higher', true, 'A little higher', 'Clearly higher'),
              cp('posture.low_back_arch', 'Low back arches', false, 'A little more curve', 'Clearly more curve'),
              cp('posture.knees_lock_back', 'Knees lock back', true, 'A little past straight', 'Clearly past straight'),
              cp('posture.feet_roll_in', 'Feet roll in', true, 'Heel rolls in a little', 'Heel clearly rolled in'),
            ],
          },
        ],
      },
    ],
    measures: [],
    followUps: [],
    sources: ['Content draft 2026-11-20, static posture: record only, not linked to muscles on its own'],
  },
  {
    key: 'side_lying_hip_hold',
    version: 1,
    name: 'Side-lying hip hold',
    summary: 'Hold each side',
    kind: 'scored',
    steps: [
      'Lie on your side, bottom knee bent, body in a straight line',
      'Lift the top leg straight, slightly behind you, toes forward',
      'Hold as long as form stays (stop at 2 min), then swap',
    ],
    views: [
      {
        id: 'back',
        label: 'Back',
        watch: 'From behind: top hip and leg',
        groups: [
          {
            label: 'Hips',
            checkpoints: [
              cp('slhh.hip_rolls_back', 'Hip rolls back', true, 'Top hip rolls back a little', 'Top hip clearly rolls back'),
              cp('slhh.leg_drifts_forward', 'Leg drifts forward', true, 'Leg drifts a little in front of the body', 'Leg clearly in front of the body'),
              cp('slhh.hip_hikes', 'Hip hikes up', true, 'Top hip moves a little toward the ribs', 'Top hip clearly hitched toward the ribs'),
            ],
          },
          {
            label: 'Feet',
            checkpoints: [cp('slhh.toes_turn_up', 'Toes turn up', true, 'Toes turn up a little', 'Toes point clearly up')],
          },
        ],
      },
    ],
    measures: [measure({ id: 'slhh.hold_time', label: 'Hold time · top leg', unit: 's', sided: true, higherIsBetter: true, min: 0, max: 120 })],
    followUps: [],
    sources: [
      'Distefano LJ et al. 2009, J Orthop Sports Phys Ther 39(7):532-40 (side-lying hip abduction: high gluteus medius activity)',
      'Selkowitz DM et al. 2013, J Orthop Sports Phys Ther 43(2):54-64 (gluteal vs TFL activity; hip rolling back and flexing recruits TFL)',
    ],
    needsReview: true,
  },
  {
    key: 'wall_shoulder_flexion',
    version: 1,
    name: 'Wall shoulder flexion',
    summary: 'Each side',
    kind: 'scored',
    steps: [
      'Back, head and bottom on the wall, feet a small step out',
      'Low back flat on the wall',
      'Raise straight arms overhead toward the wall, thumbs back',
      'Measure thumb to wall',
    ],
    views: [
      {
        id: 'side',
        label: 'Side',
        watch: 'Side: low back, elbows, shoulders',
        groups: [
          {
            label: 'Trunk',
            checkpoints: [cp('wsf.low_back_arch', 'Low back leaves the wall', false, 'Small gap opens', 'Clear arch, ribs flare')],
          },
          {
            label: 'Shoulders',
            checkpoints: [
              cp('wsf.elbow_bend', 'Elbow bends', true, 'Elbow bends a little', 'Elbow clearly bent'),
              cp('wsf.arm_drifts_out', 'Arm drifts out', true, 'Arm drifts a little to the side', 'Arm clearly out to the side'),
              cp('wsf.shoulder_hike', 'Shoulder hikes up', true, 'Shoulder lifts a little', 'Shoulder lifts clearly toward the ear'),
            ],
          },
        ],
      },
    ],
    measures: [measure({ id: 'wsf.gap', label: 'Thumb-to-wall gap', unit: 'cm', sided: true, higherIsBetter: false, min: 0, max: 40 })],
    followUps: [],
    sources: [
      'Kendall FP et al. 2005, Muscles: Testing and Function with Posture and Pain, 5th ed. (shoulder flexor / latissimus length test)',
    ],
    needsReview: true,
  },
  {
    key: 'seated_hip_internal_rotation',
    version: 1,
    name: 'Seated hip internal rotation',
    summary: 'Measure each side',
    kind: 'scored',
    steps: [
      'Sit tall on the edge of a bench, knees bent at 90°',
      'Keep the thigh still, swing the foot out to the side',
      'Measure the shin angle from vertical, then swap',
    ],
    views: [
      {
        id: 'front',
        label: 'Front',
        watch: 'Front: trunk, hips, thigh',
        groups: [
          {
            label: 'Also seen',
            checkpoints: [
              cp('hir.trunk_lean', 'Hip lifts or trunk leans', true, 'Small lean or hip lift', 'Clear lean, hip off the bench'),
              cp('hir.thigh_moves', 'Thigh moves', true, 'Knee slides a little', 'Knee clearly moves in or out'),
            ],
          },
        ],
      },
    ],
    measures: [measure({ id: 'hir.angle', label: 'Internal rotation', unit: 'deg', sided: true, higherIsBetter: true, min: 0, max: 70 })],
    followUps: [],
    sources: [
      'Ellison JB, Rose SJ, Sahrmann SA 1990, Phys Ther 70(9):537-541 (hip rotation range, sitting)',
      'Norkin CC, White DJ, Measurement of Joint Motion: A Guide to Goniometry (hip internal rotation, seated)',
    ],
    needsReview: true,
  },
];

export const BUILTIN_TEST_KEYS = BUILTIN_TESTS.map((t) => t.key);
