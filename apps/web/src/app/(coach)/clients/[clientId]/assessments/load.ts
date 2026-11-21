import {
  BUILTIN_TEST_KEYS,
  type AssessmentSlot,
  type CheckpointResult,
  type CycleSummary,
  type FootArch,
  type MeasureResult,
  type Severity,
  type Side,
  type TestDefinition,
  type TestEntry,
  type TestStatus,
} from '@caltracker/shared';
import { createServerSupabase } from '@/lib/supabase/server';

// Reads for the "Limitations & injuries" tab and an assessment's own page. Everything under the coach's session (RLS:
// only the coach of the workspace reads assessments); the workspace id comes from requireCoach(), never the browser.

type Supabase = Awaited<ReturnType<typeof createServerSupabase>>;

/** A library test as the picker shows it (the newest built-in version of each key, in library order). */
export type LibraryTest = { key: string; definition: TestDefinition };

export async function loadLibrary(supabase: Supabase): Promise<LibraryTest[]> {
  const { data, error } = await supabase
    .from('assessment_test_definitions')
    .select('test_key, version, definition')
    .is('workspace_id', null)
    .is('retired_at', null)
    .order('version', { ascending: false });
  if (error) throw new Error(`Could not load the test library: ${error.message}`);
  const seen = new Set<string>();
  const out: LibraryTest[] = [];
  for (const row of data) {
    if (seen.has(row.test_key)) continue;
    seen.add(row.test_key);
    out.push({ key: row.test_key, definition: row.definition as unknown as TestDefinition });
  }
  // Library order (the order of the boards); anything newer after.
  const place = (key: string) => {
    const i = BUILTIN_TEST_KEYS.indexOf(key);
    return i === -1 ? BUILTIN_TEST_KEYS.length : i;
  };
  return out.sort((a, b) => place(a.key) - place(b.key));
}

/** Every cycle of the client with its assessments (no test details). */
export async function loadCycles(supabase: Supabase, workspaceId: string, clientId: string): Promise<CycleSummary[]> {
  const { data, error } = await supabase
    .from('assessment_cycles')
    .select('id, number, assessments (id, slot, status, assessed_on, score)')
    .eq('workspace_id', workspaceId)
    .eq('client_id', clientId)
    .order('number', { ascending: false });
  if (error) throw new Error(`Could not load assessments: ${error.message}`);
  return data.map((c) => ({
    id: c.id,
    number: c.number,
    assessments: c.assessments.map((a) => ({
      id: a.id,
      slot: a.slot as AssessmentSlot,
      status: a.status as 'draft' | 'done',
      assessedOn: a.assessed_on,
      score: a.score,
    })),
  }));
}

export type AssessmentTest = {
  id: string;
  key: string;
  definition: TestDefinition;
  entry: TestEntry;
  score: number | null;
};

export type AssessmentDetail = {
  id: string;
  clientId: string;
  cycleNumber: number;
  slot: AssessmentSlot;
  status: 'draft' | 'done';
  assessedOn: string;
  footArchLeft: FootArch | null;
  footArchRight: FootArch | null;
  note: string;
  score: number | null;
  tests: AssessmentTest[];
};

/** One assessment with its tests, ratings and numbers, or null when it isn't this client's (or isn't visible). */
export async function loadAssessment(supabase: Supabase, workspaceId: string, clientId: string, assessmentId: string): Promise<AssessmentDetail | null> {
  const { data, error } = await supabase
    .from('assessments')
    .select(
      `id, client_id, slot, status, assessed_on, foot_arch_left, foot_arch_right, note, score,
       assessment_cycles (number),
       assessment_tests (id, position, test_key, definition, status, discomfort_left, discomfort_right, type_done, note, follow_ups, score,
         assessment_checkpoint_results (checkpoint_id, side, severity),
         assessment_measure_results (measure_id, side, value))`,
    )
    .eq('id', assessmentId)
    .eq('workspace_id', workspaceId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the assessment: ${error.message}`);
  if (!data) return null;
  const tests = [...data.assessment_tests]
    .sort((a, b) => a.position - b.position)
    .map((t) => ({
      id: t.id,
      key: t.test_key,
      definition: t.definition as unknown as TestDefinition,
      score: t.score,
      entry: {
        status: t.status as TestStatus,
        results: t.assessment_checkpoint_results.map(
          (r): CheckpointResult => ({ checkpointId: r.checkpoint_id, side: r.side as Side, severity: r.severity as Severity }),
        ),
        measures: t.assessment_measure_results.map((m): MeasureResult => ({ measureId: m.measure_id, side: m.side as Side, value: Number(m.value) })),
        followUps: (t.follow_ups ?? {}) as Record<string, string>,
        discomfortLeft: t.discomfort_left,
        discomfortRight: t.discomfort_right,
        typeDone: t.type_done,
        note: t.note,
      },
    }));
  return {
    id: data.id,
    clientId: data.client_id,
    cycleNumber: data.assessment_cycles?.number ?? 1,
    slot: data.slot as AssessmentSlot,
    status: data.status as 'draft' | 'done',
    assessedOn: data.assessed_on,
    footArchLeft: data.foot_arch_left as FootArch | null,
    footArchRight: data.foot_arch_right as FootArch | null,
    note: data.note,
    score: data.score,
    tests,
  };
}

/** The test keys of a cycle's Initial, in order: retests start from "Same as Initial". */
export async function loadInitialKeys(supabase: Supabase, workspaceId: string, cycleId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('assessments')
    .select('assessment_tests (test_key, position)')
    .eq('workspace_id', workspaceId)
    .eq('cycle_id', cycleId)
    .eq('slot', 'initial')
    .maybeSingle();
  if (error) throw new Error(`Could not load the Initial: ${error.message}`);
  return [...(data?.assessment_tests ?? [])].sort((a, b) => a.position - b.position).map((t) => t.test_key);
}
