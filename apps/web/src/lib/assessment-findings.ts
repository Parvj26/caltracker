import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BUILTIN_CORRECTIVES,
  checkpointsOf,
  confirmedMarks,
  isMuscleId,
  markStates,
  regionSides,
  toTrackingType,
  type AlsoCheckId,
  type CorrectiveChoice,
  type CorrectiveDirection,
  type CorrectivePick,
  type Database,
  type MarkReview,
  type MarkSide,
  type MarkStatus,
  type MuscleId,
  type MuscleTag,
  type StoredMark,
  type TestDefinition,
} from '@caltracker/shared';

// Step 2 reads (findings, corrective exercises, picks). Every read runs under the coach's own session: RLS limits all
// of it to the coach of the workspace. The workspace id always comes from requireCoach(), never the browser.
//
// For step 3 (report, Compare): loadAssessmentFindings() is the one read for an assessment's confirmed findings, and
// components/assessment-findings has the map and list that show them.

type Supabase = SupabaseClient<Database>;

/** Every mark the coach stored on an assessment (confirmed and rejected) and the "Also check" items ticked. */
export async function loadMarks(supabase: Supabase, workspaceId: string, assessmentId: string): Promise<{ marks: StoredMark[]; checks: AlsoCheckId[] }> {
  const [marks, checks] = await Promise.all([
    supabase.from('assessment_muscle_marks').select('muscle_id, side, status, review, sources').eq('workspace_id', workspaceId).eq('assessment_id', assessmentId),
    supabase.from('assessment_checks').select('check_id').eq('workspace_id', workspaceId).eq('assessment_id', assessmentId),
  ]);
  if (marks.error) throw new Error(`Could not load the findings: ${marks.error.message}`);
  if (checks.error) throw new Error(`Could not load the findings: ${checks.error.message}`);
  return {
    // A muscle id from a newer catalogue than this build knows is left out rather than breaking the page.
    marks: marks.data.flatMap((m) =>
      isMuscleId(m.muscle_id)
        ? [{ muscleId: m.muscle_id, side: m.side as MarkSide, status: m.status as MarkStatus, review: m.review as MarkReview, sources: m.sources }]
        : [],
    ),
    checks: checks.data.map((c) => c.check_id as AlsoCheckId),
  };
}

/** The picked exercises, in order. */
export async function loadPicks(supabase: Supabase, workspaceId: string, assessmentId: string): Promise<{ picks: CorrectivePick[]; saved: boolean }> {
  const { data, error } = await supabase
    .from('assessment_exercise_picks')
    .select('muscle_id, status, exercise_id, position')
    .eq('workspace_id', workspaceId)
    .eq('assessment_id', assessmentId)
    .order('position');
  if (error) throw new Error(`Could not load the picks: ${error.message}`);
  return {
    picks: data.flatMap((p) => (isMuscleId(p.muscle_id) ? [{ muscleId: p.muscle_id, status: p.status as 'over' | 'under', exerciseId: p.exercise_id }] : [])),
    saved: data.length > 0,
  };
}

type ExerciseRow = { id: string; name: string; tracking_type: string; image_paths: string[] };

/** The exercise's first picture as a public URL (exercise-images is a public bucket), or null. */
const choiceFrom = (supabase: Supabase, e: ExerciseRow) => ({
  exerciseId: e.id,
  name: e.name,
  trackingType: toTrackingType(e.tracking_type),
  imageUrl: e.image_paths[0] ? supabase.storage.from('exercise-images').getPublicUrl(e.image_paths[0]).data.publicUrl : null,
});

/**
 * The corrective exercises a workspace can offer: the coach's own (corrective_exercises, newest first) and the
 * built-in defaults whose exercise is in the library (BUILTIN_CORRECTIVES order, matched by name).
 */
export async function loadCorrectiveChoices(supabase: Supabase, workspaceId: string): Promise<{ coach: CorrectiveChoice[]; builtins: CorrectiveChoice[] }> {
  const names = BUILTIN_CORRECTIVES.map((b) => b.libraryName);
  const [own, lib] = await Promise.all([
    supabase
      .from('corrective_exercises')
      .select('id, direction, default_sets, default_reps, default_seconds, each_side, created_at, exercises (id, name, tracking_type, image_paths), corrective_exercise_muscles (muscle_id, side)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),
    // Case-insensitive match (ilike with no wildcards: the names have no % _ " , or \, a shared test checks), each
    // quoted for the array literal (names have spaces, brackets and apostrophes).
    supabase.from('exercises').select('id, name, tracking_type, image_paths').is('workspace_id', null).ilikeAnyOf('name', names.map((n) => `"${n}"`)),
  ]);
  if (own.error) throw new Error(`Could not load corrective exercises: ${own.error.message}`);
  if (lib.error) throw new Error(`Could not load corrective exercises: ${lib.error.message}`);

  const coach: CorrectiveChoice[] = own.data.flatMap((c) => {
    const e = c.exercises as ExerciseRow | null;
    if (!e) return [];
    const muscles: MuscleTag[] = c.corrective_exercise_muscles.flatMap((m) => (isMuscleId(m.muscle_id) ? [{ muscleId: m.muscle_id, side: m.side as MarkSide }] : []));
    return [
      {
        ...choiceFrom(supabase, e),
        direction: c.direction as CorrectiveDirection,
        muscles,
        dose: { sets: c.default_sets, reps: c.default_reps, seconds: c.default_seconds, eachSide: c.each_side },
        correctiveId: c.id,
        builtinKey: null,
        evidence: null,
      },
    ];
  });

  // Two built-ins can differ only in case ("Split Squats"): the first one found wins.
  const byName = new Map<string, ExerciseRow>();
  for (const e of lib.data) if (!byName.has(e.name.toLowerCase())) byName.set(e.name.toLowerCase(), e);
  const builtins: CorrectiveChoice[] = BUILTIN_CORRECTIVES.flatMap((b) => {
    const e = byName.get(b.libraryName.toLowerCase());
    if (!e) return [];
    return [
      {
        ...choiceFrom(supabase, e),
        direction: b.direction,
        muscles: b.muscles.flatMap((m) => regionSides(m).map((side) => ({ muscleId: m, side }))),
        dose: b.dose,
        correctiveId: null,
        builtinKey: b.key,
        evidence: b.evidence,
      },
    ];
  });
  return { coach, builtins };
}

/** Checkpoint id → the words the coach saw ("Knees cave in"), from the assessment's own definition copies. */
export function checkpointLabels(definitions: readonly TestDefinition[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of definitions) {
    for (const c of checkpointsOf(d)) {
      const label = c.finding ?? c.label;
      out[c.id] = d.kind === 'record_only' ? `${label} · posture` : label;
    }
  }
  return out;
}

/** One confirmed finding row for the report: a muscle group, its status, its sides and where it came from. */
export type FindingRow = { muscleId: MuscleId; status: MarkStatus; sides: MarkSide[]; from: string[] };

export type AssessmentFindings = {
  /** Every confirmed mark, catalogue order. */
  marks: StoredMark[];
  /** BodyMap `states` (confirmed only), keyed `glute_medius.L` / `abs`. */
  states: Record<string, MarkStatus>;
  /** Confirmed marks by muscle and status (over, under, then normal), with the findings they came from. */
  rows: FindingRow[];
  /** "Also check" items the coach ticked. */
  checks: AlsoCheckId[];
};

/**
 * An assessment's confirmed findings, ready for a report or Compare (step 3). Null when the assessment isn't this
 * coach's. Compare joins on (muscleId, side) across assessments.
 */
export async function loadAssessmentFindings(supabase: Supabase, workspaceId: string, assessmentId: string): Promise<AssessmentFindings | null> {
  const { data, error } = await supabase
    .from('assessment_tests')
    .select('definition')
    .eq('workspace_id', workspaceId)
    .eq('assessment_id', assessmentId);
  if (error) throw new Error(`Could not load the findings: ${error.message}`);
  const { data: a, error: aError } = await supabase.from('assessments').select('id').eq('workspace_id', workspaceId).eq('id', assessmentId).maybeSingle();
  if (aError) throw new Error(`Could not load the findings: ${aError.message}`);
  if (!a) return null;
  const labels = checkpointLabels(data.map((t) => t.definition as unknown as TestDefinition));
  const { marks, checks } = await loadMarks(supabase, workspaceId, assessmentId);
  return findingsFrom(marks, checks, labels);
}

/** The same shape from marks already loaded (pages that have them). */
export function findingsFrom(marks: readonly StoredMark[], checks: readonly AlsoCheckId[], labels: Readonly<Record<string, string>>): AssessmentFindings {
  const confirmed = confirmedMarks(marks);
  const rows: FindingRow[] = [];
  for (const status of ['over', 'under', 'normal'] as const) {
    for (const m of confirmed) {
      if (m.status !== status) continue;
      const row = rows.find((r) => r.muscleId === m.muscleId && r.status === status);
      const from = m.sources.map((s) => labels[s] ?? s);
      if (row) {
        row.sides.push(m.side);
        for (const f of from) if (!row.from.includes(f)) row.from.push(f);
      } else rows.push({ muscleId: m.muscleId, status, sides: [m.side], from: [...new Set(from)] });
    }
  }
  return { marks: confirmed, states: markStates(confirmed), rows, checks: [...checks] };
}

