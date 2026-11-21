/**
 * Movement assessments (coach website "Limitations & injuries" tab; client app Progress in a later step).
 *
 * A test definition is plain data. Built-in definitions live in BUILTIN_TESTS (library.ts) and are seeded into
 * public.assessment_test_definitions; every test done in an assessment keeps a copy (snapshot) of the definition it
 * was run with, so later library edits never change an old assessment or break Compare.
 *
 * Checkpoint and measure ids are stable across versions (e.g. `ohs.knee_valgus`): Compare joins on (id, side).
 */

/** How far a checkpoint goes, per side. Normal is the default: an untouched line counts as Normal. */
export const SEVERITIES = ['normal', 'slight', 'severe'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** 'L' and 'R' for sided checkpoints and measures, 'none' for unsided ones. */
export const SIDES = ['L', 'R', 'none'] as const;
export type Side = (typeof SIDES)[number];

/** Foot arch, standing with shoes on, recorded once per assessment before the tests. */
export const FOOT_ARCHES = ['flat', 'normal', 'high'] as const;
export type FootArch = (typeof FOOT_ARCHES)[number];

/** The three assessments of a cycle. Retest 2 is optional. */
export const ASSESSMENT_SLOTS = ['initial', 'retest_1', 'retest_2'] as const;
export type AssessmentSlot = (typeof ASSESSMENT_SLOTS)[number];

/** A test inside an assessment: not yet looked at, done, skipped (Not tested) or stopped part-way. */
export const TEST_STATUSES = ['pending', 'done', 'skipped', 'stopped'] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export type CheckpointDef = {
  /** Stable id, `<test prefix>.<what>`, e.g. `ohs.knee_valgus`. Never reused for something else. */
  id: string;
  /** Short label as the coach reads it ("Cave in (valgus)"). */
  label: string;
  /** The line in findings lists, where the label alone needs its region ("Knees cave in"). Defaults to the label. */
  finding?: string;
  /** Rated per side (L and R) or once. */
  sided: boolean;
  /** What Slight and Severe mean for this checkpoint, judged by how far it goes. */
  guide?: { slight: string; severe: string };
};

/** A body region heading inside a view ("Feet", "Knees", "Also seen"). */
export type CheckpointGroup = { label: string; checkpoints: CheckpointDef[] };

/** Where the coach stands. Tests with two views get a Front / Side switch on a phone. */
export type TestView = {
  id: 'front' | 'side' | 'back';
  label: string;
  /** The one "what to watch" line for this view ("Front: feet, knees, hips"). */
  watch: string;
  groups: CheckpointGroup[];
};

export type MeasureDef = {
  /** Stable id, e.g. `shm.reach_gap`. */
  id: string;
  label: string;
  unit: 'cm' | 'deg' | 's';
  sided: boolean;
  /** Compare reads a change as better or worse with this. */
  higherIsBetter: boolean;
  min: number;
  max: number;
};

/** A one-question follow-up shown under a checkpoint once that checkpoint is Slight or Severe on any side. */
export type FollowUpDef = {
  id: string;
  label: string;
  prompt: string;
  /** The checkpoint it belongs to: shown right after it, and only while it is not Normal. */
  after: string;
  options: { value: string; label: string }[];
};

export type TestDefinition = {
  /** Stable key of the test across versions ('overhead_squat'). */
  key: string;
  version: number;
  name: string;
  /** One line under the name in the picker ("Front + side · shoes on"). */
  summary: string;
  /** 'scored' counts toward the Movement score; 'record_only' (posture) never does. */
  kind: 'scored' | 'record_only';
  /** Short how-to, one line per step. No rep count is shown. */
  steps: string[];
  views: TestView[];
  measures: MeasureDef[];
  followUps: FollowUpDef[];
  /** A free-text "Type done" box (push-up: floor, incline, knees). */
  typeDone?: { label: string; placeholder: string };
  /** Where the content comes from, short references. */
  sources: string[];
  /** Drafted content the coach still has to review before it is final. */
  needsReview?: boolean;
};

/** One rating as stored: a checkpoint on one side. */
export type CheckpointResult = { checkpointId: string; side: Side; severity: Severity };

/** One number as stored. */
export type MeasureResult = { measureId: string; side: Side; value: number };
