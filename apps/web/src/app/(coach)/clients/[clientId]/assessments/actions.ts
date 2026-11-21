'use server';

import { revalidatePath } from 'next/cache';
import {
  ASSESSMENT_NOTE_MAX,
  ASSESSMENT_SLOTS,
  FOOT_ARCHES,
  checkTestEntry,
  movementScore,
  testScore,
  type AssessmentSlot,
  type CheckpointResult,
  type FootArch,
  type Severity,
  type Side,
  type TestDefinition,
  type TestStatus,
} from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// Movement assessments: start one, save a test (autosave, Next, Skip, Stop), finish. Every action starts with
// requireCoach(); the workspace id never comes from the browser. The database checks again (RLS and the functions in
// 20261121000100_assessments.sql, all running as the coach): only a current client, only a draft, only checkpoints and
// numbers the test's own definition has. Scores come from the shared movementScore(), the one rule for every app.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z][a-z0-9_]{1,60}$/;
const refresh = () => revalidatePath('/clients/[clientId]', 'layout');

export type StartInput = {
  clientId: string;
  slot: AssessmentSlot;
  /** Start the Initial of a new cycle (after Retest 1). */
  newCycle: boolean;
  /** The coach's local day (YYYY-MM-DD). */
  assessedOn: string;
  footArchLeft: FootArch | null;
  footArchRight: FootArch | null;
  note: string;
  /** Library keys in the order picked. */
  testKeys: string[];
};

export async function startAssessment(input: StartInput): Promise<{ ok: true; id: string } | ActionFailure> {
  const { workspaceId } = await requireCoach();
  const { clientId, slot, newCycle, assessedOn, footArchLeft, footArchRight, note, testKeys } = input;
  const arch = (v: unknown) => v === null || (typeof v === 'string' && (FOOT_ARCHES as readonly string[]).includes(v));
  if (
    !isUuid(clientId) || !(ASSESSMENT_SLOTS as readonly string[]).includes(slot) || typeof newCycle !== 'boolean' ||
    typeof assessedOn !== 'string' || !DATE.test(assessedOn) || !arch(footArchLeft) || !arch(footArchRight) ||
    typeof note !== 'string' || note.trim().length > ASSESSMENT_NOTE_MAX || !Array.isArray(testKeys) ||
    testKeys.length === 0 || testKeys.length > 20 || !testKeys.every((k) => typeof k === 'string' && KEY.test(k)) ||
    new Set(testKeys).size !== testKeys.length
  ) {
    return fail('assessment_invalid', 'action:assessments.start');
  }
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('start_assessment', {
    p_workspace_id: workspaceId,
    p_client_id: clientId,
    p_slot: slot,
    p_new_cycle: newCycle,
    p_assessed_on: assessedOn,
    // The generated types say string; the function takes null for "not recorded".
    p_foot_arch_left: footArchLeft as string,
    p_foot_arch_right: footArchRight as string,
    p_note: note.trim(),
    p_test_keys: testKeys,
  });
  if (error) return failFor(error, 'assessment_start_failed', 'action:assessments.start');
  refresh();
  return { ok: true, id: data };
}

export async function saveAssessmentTest(testId: string, entry: unknown): Promise<{ ok: true; score: number | null } | ActionFailure> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(testId)) return fail('assessment_invalid', 'action:assessments.saveTest');
  const supabase = await createServerSupabase();
  const { data: row, error: readError } = await supabase
    .from('assessment_tests')
    .select('definition')
    .eq('id', testId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (readError) return fail('assessment_save_failed', 'action:assessments.saveTest');
  if (!row) return fail('assessment_denied', 'action:assessments.saveTest');
  const definition = row.definition as unknown as TestDefinition;
  const checked = checkTestEntry(definition, entry);
  if (!checked) return fail('assessment_invalid', 'action:assessments.saveTest');
  const score = testScore({ definition, status: checked.status, results: checked.results });
  const { error } = await supabase.rpc('save_assessment_test', {
    p_test_id: testId,
    p_status: checked.status,
    p_results: checked.results.map((r) => ({ checkpoint_id: r.checkpointId, side: r.side, severity: r.severity })),
    p_measures: checked.measures.map((m) => ({ measure_id: m.measureId, side: m.side, value: m.value })),
    p_follow_ups: checked.followUps,
    p_discomfort_left: checked.discomfortLeft,
    p_discomfort_right: checked.discomfortRight,
    p_type_done: checked.typeDone,
    p_note: checked.note,
    // The generated types say number; the column takes null for "not scored".
    p_score: score as number,
  });
  if (error) return failFor(error, 'assessment_save_failed', 'action:assessments.saveTest');
  return { ok: true, score };
}

export async function finishAssessment(assessmentId: string): Promise<{ ok: true; score: number | null } | ActionFailure> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(assessmentId)) return fail('assessment_invalid', 'action:assessments.finish');
  const supabase = await createServerSupabase();
  const { data, error: readError } = await supabase
    .from('assessment_tests')
    .select('id, definition, status, assessment_checkpoint_results (checkpoint_id, side, severity)')
    .eq('assessment_id', assessmentId)
    .eq('workspace_id', workspaceId)
    .order('position');
  if (readError) return fail('assessment_finish_failed', 'action:assessments.finish');
  if (data.length === 0) return fail('assessment_denied', 'action:assessments.finish');
  // Tests never reached count as skipped (the database marks them so too).
  const inputs = data.map((t) => ({
    definition: t.definition as unknown as TestDefinition,
    status: (t.status === 'pending' ? 'skipped' : t.status) as TestStatus,
    results: t.assessment_checkpoint_results.map(
      (r): CheckpointResult => ({ checkpointId: r.checkpoint_id, side: r.side as Side, severity: r.severity as Severity }),
    ),
  }));
  const scores = movementScore(inputs);
  const { error } = await supabase.rpc('finish_assessment', {
    p_assessment_id: assessmentId,
    p_scores: data.map((t, i) => ({ test_id: t.id, score: scores.tests[i]?.score ?? null })),
    // The generated types say number; the column takes null when nothing was scored.
    p_overall: scores.overall as number,
  });
  if (error) return failFor(error, 'assessment_finish_failed', 'action:assessments.finish');
  refresh();
  return { ok: true, score: scores.overall };
}

function failFor(
  error: { code?: string; message?: string },
  fallback: 'assessment_start_failed' | 'assessment_save_failed' | 'assessment_finish_failed',
  where: string,
): ActionFailure {
  if (error.code === '42501') return fail('assessment_denied', where);
  if (error.code === '23505' || (error.code === '23514' && /finish|cycle/i.test(error.message ?? ''))) return fail('assessment_order', where);
  if (error.code === '23514' || error.code === '22023' || error.code === '22P02') return fail('assessment_invalid', where);
  return fail(fallback, where);
}
