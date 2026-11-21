import { checkpointLabelMap } from './findings';
import { checkpointsOf, movementScore, type NotScored } from './score';
import type { AssessmentSlot, CheckpointResult, MeasureDef, Severity, Side, TestDefinition, TestStatus } from './types';

/**
 * Compare (board AS7): two or three finished assessments of a cycle side by side (Initial → Retest 1 → Retest 2).
 *
 * - Movement score: overall and per test, with the change from the first column to the last. The overall change is
 *   like-for-like: when the two ends scored different tests, it is worked out again over only the tests scored in
 *   both (`sameTests`), so adding or skipping a test never reads as progress.
 * - Findings: every checkpoint the coach rated Slight or Severe in any column, joined on (checkpoint id, side). Ids are
 *   stable across library versions, so a retest run on a newer version still lines up. The change (first → last):
 *   Improved (less far), Same, New (Normal before), Worse (Slight → Severe), or Not tested when either end has no
 *   rating (test skipped, not in that assessment, or a checkpoint the older version didn't have).
 * - Measurements: each (measure id, side) with the change, read as better or worse with the unit and the
 *   higher-is-better stored with the number. A number from a stopped test is shown but never read as a change.
 *
 * A line whose two sides read the same in every column shows once as "· L R" (the boards' "Heels lift · L R").
 * Counts (improved / same / new / worse) count the lines shown; Not tested lines are left out of them.
 */

export type CompareMeasure = { measureId: string; side: Side; value: number; unit: MeasureDef['unit']; higherIsBetter: boolean };

export type CompareTest = {
  definition: TestDefinition;
  status: TestStatus;
  results: readonly CheckpointResult[];
  measures: readonly CompareMeasure[];
};

export type CompareAssessment = {
  id: string;
  slot: AssessmentSlot;
  /** YYYY-MM-DD. */
  assessedOn: string;
  /** The stored overall score; worked out again from the ratings when missing. */
  score: number | null;
  tests: readonly CompareTest[];
};

/** A checkpoint in one column: its rating, or not tested. */
export type CompareValue = Severity | 'not_tested';
export type FindingChange = 'improved' | 'same' | 'new' | 'worse' | 'not_tested';
/** `stopped`: either end comes from a stopped test, so the numbers aren't compared. */
export type MeasureChange = 'improved' | 'same' | 'worse' | 'not_tested' | 'stopped';

export type CompareFindingRow = {
  checkpointId: string;
  /** "Heels lift", "Head forward · posture", or "Knees cave in · Overhead squat" when two tests have the same words. */
  label: string;
  /** 'L', 'R', 'LR' (both sides read the same everywhere) or 'none' (an unsided checkpoint). */
  side: Side | 'LR';
  recordOnly: boolean;
  values: CompareValue[];
  change: FindingChange;
};

export type CompareMeasureRow = {
  measureId: string;
  label: string;
  side: Side;
  unit: MeasureDef['unit'];
  higherIsBetter: boolean;
  /** null: not measured in that column. */
  values: (number | null)[];
  /** Last minus first, rounded to 0.1; null when either end is missing (or the units differ). */
  delta: number | null;
  change: MeasureChange;
};

export type CompareScoreCell = { score: number | null; notScored: NotScored | 'not_in_assessment' | null };

export type CompareTestScoreRow = {
  key: string;
  name: string;
  recordOnly: boolean;
  cells: CompareScoreCell[];
  /** Last minus first when both are scored. */
  delta: number | null;
};

export type Comparison = {
  /**
   * `values`: each column's full score. `delta`: last minus first, like-for-like. `sameTests`: both ends worked out
   * over only the tests scored in both, when the two ends scored different tests (null when they scored the same ones,
   * or share none).
   */
  overall: { values: (number | null)[]; delta: number | null; sameTests: { from: number; to: number } | null };
  tests: CompareTestScoreRow[];
  findings: CompareFindingRow[];
  findingCounts: Record<'improved' | 'same' | 'new' | 'worse', number>;
  measures: CompareMeasureRow[];
  measureCounts: Record<'improved' | 'same' | 'worse', number>;
};

const RANK: Record<Severity, number> = { normal: 0, slight: 1, severe: 2 };
const SIDE_ORDER: Record<Side, number> = { L: 0, R: 1, none: 2 };

/** First → last of a findings line. */
export function findingChange(from: CompareValue, to: CompareValue): FindingChange {
  if (from === 'not_tested' || to === 'not_tested') return 'not_tested';
  if (RANK[to] < RANK[from]) return 'improved';
  if (RANK[to] === RANK[from]) return 'same';
  return from === 'normal' ? 'new' : 'worse';
}

/** A measurement's change: better when it moved the right way for this measure (e.g. a smaller gap in cm). */
export function measureChange(from: number | null, to: number | null, higherIsBetter: boolean): { delta: number | null; change: MeasureChange } {
  if (from === null || to === null) return { delta: null, change: 'not_tested' };
  const delta = Math.round((to - from) * 10) / 10;
  if (delta === 0) return { delta: 0, change: 'same' };
  return { delta, change: delta > 0 === higherIsBetter ? 'improved' : 'worse' };
}

/** "+10°", "−4 cm", "+5 s", "0 cm". A true minus sign. */
export function formatMeasureDelta(delta: number, unit: MeasureDef['unit']): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return `${sign}${formatMeasureValue(Math.abs(delta), unit)}`;
}

/** "14 cm", "60°", "45 s". */
export function formatMeasureValue(value: number, unit: MeasureDef['unit']): string {
  return unit === 'deg' ? `${value}°` : `${value} ${unit}`;
}

/**
 * The two assessments a phone compares (indexes into the cycle's finished ones, in slot order), earlier first:
 * "from Retest 1 with Initial" is read as Initial → Retest 1, never backwards.
 */
export function orderColumnPicks([a, b]: readonly [number, number]): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/** "+17", "−3", "0". */
export function formatScoreDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0';
}

type Line = { checkpointId: string; side: Side; label: string; recordOnly: boolean; order: number };

/** The rating of one checkpoint side in one assessment, or not tested. */
function valueIn(a: CompareAssessment, checkpointId: string, side: Side): CompareValue {
  for (const t of a.tests) {
    const c = checkpointsOf(t.definition).find((x) => x.id === checkpointId);
    if (!c) continue;
    if (c.sided ? side === 'none' : side !== 'none') return 'not_tested';
    const r = t.results.find((x) => x.checkpointId === checkpointId && x.side === side);
    if (t.status === 'done') return r?.severity ?? 'normal';
    // A stopped test keeps what was seen before it stopped; a line it never got to isn't a Normal.
    if (t.status === 'stopped' && r && r.severity !== 'normal') return r.severity;
    return 'not_tested';
  }
  return 'not_tested';
}

const scoreInputs = (a: CompareAssessment) => a.tests.map((t) => ({ definition: t.definition, status: t.status, results: t.results }));

/** The keys of the tests that got a score in an assessment, sorted. */
function scoredKeys(a: CompareAssessment | undefined): string[] {
  if (!a) return [];
  return movementScore(scoreInputs(a)).tests.flatMap((t) => (t.score !== null ? [t.key] : [])).sort();
}

/**
 * Both ends worked out over only the tests scored in both; null when they scored the same tests (the full scores are
 * already like-for-like) or share none.
 */
function likeForLike([first, last]: [CompareAssessment | undefined, CompareAssessment | undefined]): { from: number; to: number } | null {
  if (!first || !last) return null;
  const a = scoredKeys(first);
  const b = scoredKeys(last);
  if (a.join() === b.join()) return null;
  const both = new Set(a.filter((k) => b.includes(k)));
  if (both.size === 0) return null;
  const over = (x: CompareAssessment) => movementScore(scoreInputs(x).filter((t) => both.has(t.definition.key))).overall;
  const from = over(first);
  const to = over(last);
  return from !== null && to !== null ? { from, to } : null;
}

export function compareAssessments(columns: readonly CompareAssessment[]): Comparison {
  const last = columns.length - 1;
  const firstLast = <T>(values: T[]): [T, T] => [values[0] as T, values[last] as T];

  // ---- Scores ----
  const scored = columns.map((a) => movementScore(a.tests.map((t) => ({ definition: t.definition, status: t.status, results: t.results }))));
  const overallValues = columns.map((a, i) => a.score ?? scored[i]?.overall ?? null);
  const [o1, o2] = firstLast(overallValues);
  const sameTests = likeForLike(firstLast([...columns]));
  const testKeys: { key: string; name: string; recordOnly: boolean }[] = [];
  for (const a of columns) {
    for (const t of a.tests) {
      const known = testKeys.find((k) => k.key === t.definition.key);
      if (known) {
        known.name = t.definition.name;
      } else {
        testKeys.push({ key: t.definition.key, name: t.definition.name, recordOnly: t.definition.kind === 'record_only' });
      }
    }
  }
  const tests: CompareTestScoreRow[] = testKeys.map(({ key, name, recordOnly }) => {
    const cells = columns.map((a, i): CompareScoreCell => {
      const at = a.tests.findIndex((t) => t.definition.key === key);
      if (at === -1) return { score: null, notScored: 'not_in_assessment' };
      const s = scored[i]?.tests[at];
      return { score: s?.score ?? null, notScored: s?.notScored ?? null };
    });
    const [c1, c2] = firstLast(cells);
    return { key, name, recordOnly, cells, delta: c1.score !== null && c2.score !== null ? c2.score - c1.score : null };
  });

  // ---- Findings ----
  const lines = new Map<string, Line>();
  let order = 0;
  // Labels come from the newest column that has the checkpoint (its wording wins); order from the first time seen.
  const newestFirst = [...columns].reverse();
  const labels = checkpointLabelMap(newestFirst.flatMap((a) => a.tests.map((t) => t.definition)));
  for (const a of newestFirst) {
    for (const t of a.tests) {
      for (const c of checkpointsOf(t.definition)) {
        for (const side of c.sided ? (['L', 'R'] as const) : (['none'] as const)) {
          const k = `${c.id}|${side}`;
          if (lines.has(k)) continue;
          const recordOnly = t.definition.kind === 'record_only';
          lines.set(k, { checkpointId: c.id, side, label: labels[c.id] ?? c.label, recordOnly, order: 0 });
        }
      }
    }
  }
  for (const a of columns) {
    for (const t of a.tests) {
      for (const c of checkpointsOf(t.definition)) {
        for (const side of c.sided ? (['L', 'R'] as const) : (['none'] as const)) {
          const line = lines.get(`${c.id}|${side}`);
          if (line && line.order === 0) line.order = ++order;
        }
      }
    }
  }
  type Raw = Line & { values: CompareValue[] };
  const raw: Raw[] = [];
  for (const line of lines.values()) {
    const values = columns.map((a) => valueIn(a, line.checkpointId, line.side));
    if (!values.some((v) => v === 'slight' || v === 'severe')) continue;
    raw.push({ ...line, values });
  }
  raw.sort((a, b) => Number(a.recordOnly) - Number(b.recordOnly) || a.order - b.order || SIDE_ORDER[a.side] - SIDE_ORDER[b.side]);
  const findings: CompareFindingRow[] = [];
  for (const r of raw) {
    if (r.side === 'R') {
      const left = findings.find((f) => f.checkpointId === r.checkpointId && f.side === 'L');
      if (left && left.values.every((v, i) => v === r.values[i])) {
        left.side = 'LR';
        continue;
      }
    }
    const [from, to] = firstLast(r.values);
    findings.push({ checkpointId: r.checkpointId, label: r.label, side: r.side, recordOnly: r.recordOnly, values: r.values, change: findingChange(from, to) });
  }
  // An L line with no matching R line stays "L" (the R side was Normal everywhere, or differed).
  const findingCounts = { improved: 0, same: 0, new: 0, worse: 0 };
  for (const f of findings) if (f.change !== 'not_tested') findingCounts[f.change] += 1;

  // ---- Measurements ----
  type MeasureLine = { measureId: string; side: Side; label: string; unit: MeasureDef['unit']; higherIsBetter: boolean; order: number };
  const mlines = new Map<string, MeasureLine>();
  let morder = 0;
  for (const a of columns) {
    for (const t of a.tests) {
      for (const m of t.definition.measures) {
        for (const side of m.sided ? (['L', 'R'] as const) : (['none'] as const)) {
          const k = `${m.id}|${side}`;
          if (!mlines.has(k)) mlines.set(k, { measureId: m.id, side, label: m.label, unit: m.unit, higherIsBetter: m.higherIsBetter, order: ++morder });
        }
      }
    }
  }
  // Like findings: the newest column's wording wins (order stays from the first time seen).
  const relabelled = new Set<string>();
  for (const a of [...columns].reverse()) {
    for (const t of a.tests) {
      for (const m of t.definition.measures) {
        for (const side of m.sided ? (['L', 'R'] as const) : (['none'] as const)) {
          const k = `${m.id}|${side}`;
          const line = mlines.get(k);
          if (!line || relabelled.has(k)) continue;
          relabelled.add(k);
          line.label = m.label;
        }
      }
    }
  }
  const measures: CompareMeasureRow[] = [];
  for (const line of [...mlines.values()].sort((a, b) => a.order - b.order)) {
    const found = columns.map((a) => {
      for (const t of a.tests) {
        if (t.status === 'skipped' || t.status === 'pending') continue;
        const v = t.measures.find((x) => x.measureId === line.measureId && x.side === line.side);
        if (v) return { ...v, stopped: t.status === 'stopped' };
      }
      return null;
    });
    if (found.every((v) => v === null)) continue;
    const [f1, f2] = firstLast(found);
    const stopped = f1?.stopped === true || f2?.stopped === true;
    // The unit and direction stored with the numbers; a change of unit between versions can't be compared.
    const unit = f2?.unit ?? f1?.unit ?? line.unit;
    const higherIsBetter = f2?.higherIsBetter ?? f1?.higherIsBetter ?? line.higherIsBetter;
    const comparable = f1 !== null && f2 !== null && f1.unit === f2.unit && f1.higherIsBetter === f2.higherIsBetter;
    const { delta, change }: { delta: number | null; change: MeasureChange } =
      comparable && stopped ? { delta: null, change: 'stopped' }
      : comparable ? measureChange(f1.value, f2.value, higherIsBetter)
      : { delta: null, change: 'not_tested' };
    measures.push({
      measureId: line.measureId,
      label: line.label,
      side: line.side,
      unit,
      higherIsBetter,
      values: found.map((v) => v?.value ?? null),
      delta,
      change,
    });
  }
  const measureCounts = { improved: 0, same: 0, worse: 0 };
  for (const m of measures) if (m.change !== 'not_tested' && m.change !== 'stopped') measureCounts[m.change] += 1;

  const delta = sameTests ? sameTests.to - sameTests.from : o1 !== null && o2 !== null && scoredKeys(columns[0]).join() === scoredKeys(columns[last]).join() ? o2 - o1 : null;
  return {
    overall: { values: overallValues, delta, sameTests },
    tests,
    findings,
    findingCounts,
    measures,
    measureCounts,
  };
}
