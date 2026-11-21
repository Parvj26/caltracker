import type { CheckpointDef, CheckpointResult, Severity, TestDefinition, TestStatus } from './types';

/**
 * The Movement score, 0–100, from what the coach observed only (approved by Luis and the PO, board AS12):
 * - every checkpoint of a done, scored test counts per side (sided: L and R; unsided: once);
 * - Normal 2 points, Slight 1, Severe 0; an untouched line is Normal;
 * - score = points ÷ max points × 100, rounded, per test and overall (overall pools the points of every scored test);
 * - skipped and stopped tests, measurements and record-only tests (posture) are left out.
 * Used by the coach website when it saves an assessment, and later by the client app to show the same number.
 */

const POINTS: Record<Severity, number> = { normal: 2, slight: 1, severe: 0 };

export type ScoreInput = { definition: TestDefinition; status: TestStatus; results: readonly CheckpointResult[] };

/** Why a test has no score. */
export type NotScored = 'skipped' | 'stopped' | 'not_done' | 'record_only' | 'measured';

export type TestScore = { key: string; score: number | null; notScored: NotScored | null };

export function checkpointsOf(definition: TestDefinition): CheckpointDef[] {
  return definition.views.flatMap((v) => v.groups.flatMap((g) => g.checkpoints));
}

function points(input: ScoreInput): { got: number; max: number } | NotScored {
  if (input.status === 'skipped') return 'skipped';
  if (input.status === 'stopped') return 'stopped';
  if (input.status !== 'done') return 'not_done';
  if (input.definition.kind === 'record_only') return 'record_only';
  const checkpoints = checkpointsOf(input.definition);
  if (checkpoints.length === 0) return 'measured';
  const seen = new Map<string, Severity>();
  for (const r of input.results) seen.set(`${r.checkpointId}|${r.side}`, r.severity);
  let got = 0;
  let max = 0;
  for (const c of checkpoints) {
    for (const side of c.sided ? (['L', 'R'] as const) : (['none'] as const)) {
      got += POINTS[seen.get(`${c.id}|${side}`) ?? 'normal'];
      max += POINTS.normal;
    }
  }
  return { got, max };
}

const percent = (got: number, max: number) => Math.round((got / max) * 100);

/** One test's score, or null when it doesn't count (see NotScored). */
export function testScore(input: ScoreInput): number | null {
  const p = points(input);
  return typeof p === 'string' ? null : percent(p.got, p.max);
}

/** Every test's score (in the order given) and the overall score; overall is null when no test counted. */
export function movementScore(tests: readonly ScoreInput[]): { overall: number | null; tests: TestScore[] } {
  let got = 0;
  let max = 0;
  const out: TestScore[] = tests.map((t) => {
    const p = points(t);
    if (typeof p === 'string') return { key: t.definition.key, score: null, notScored: p };
    got += p.got;
    max += p.max;
    return { key: t.definition.key, score: percent(p.got, p.max), notScored: null };
  });
  return { overall: max > 0 ? percent(got, max) : null, tests: out };
}

export const SCORE_BANDS = [
  { id: 'needs_work', label: 'Needs work', min: 0 },
  { id: 'fair', label: 'Fair', min: 50 },
  { id: 'good', label: 'Good', min: 70 },
  { id: 'great', label: 'Great', min: 85 },
] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

/** 0–49 Needs work, 50–69 Fair, 70–84 Good, 85–100 Great. */
export function scoreBand(score: number): ScoreBand {
  let band: ScoreBand = SCORE_BANDS[0];
  for (const b of SCORE_BANDS) if (score >= b.min) band = b;
  return band;
}
