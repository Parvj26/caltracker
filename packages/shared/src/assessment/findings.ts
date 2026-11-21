import { checkpointsOf } from './score';
import type { CheckpointResult, Severity, Side, TestDefinition, TestStatus } from './types';

/**
 * The "Observed" list (boards AS1, AS6): every checkpoint the coach rated Slight or Severe on any side, worst first.
 * Only what was tapped; nothing is guessed. Skipped tests show nothing; a stopped test keeps what was entered.
 */

export type FindingSide = { side: Side; severity: Exclude<Severity, 'normal'> };

export type Finding = {
  checkpointId: string;
  label: string;
  testKey: string;
  testName: string;
  recordOnly: boolean;
  sides: FindingSide[];
  worst: Exclude<Severity, 'normal'>;
};

export type FindingsInput = { definition: TestDefinition; status: TestStatus; results: readonly CheckpointResult[] };

const SIDE_ORDER: Record<Side, number> = { L: 0, R: 1, none: 2 };

/** "Knee caves in" and "Knees cave in" read as the same words: lower case, no punctuation, no plural -s. */
const wordsKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 ? w.replace(/s$/, '') : w))
    .join(' ');

/**
 * Checkpoint id → the words the coach saw ("Knees cave in"), for every checkpoint of the given tests. Record-only
 * tests add "· posture". When movement checkpoints of two different tests read the same ("Knee caves in" on the single-leg
 * squat, "Knees cave in" on the overhead squat), each gets its test's name instead, e.g. "Knees cave in · Overhead
 * squat", so they don't look like a typo side by side. The first definition with an id wins (pass the newest first).
 */
export function checkpointLabelMap(definitions: readonly TestDefinition[]): Record<string, string> {
  const seen: { id: string; base: string; testKey: string; testName: string; recordOnly: boolean }[] = [];
  for (const d of definitions) {
    for (const c of checkpointsOf(d)) {
      if (seen.some((x) => x.id === c.id)) continue;
      seen.push({ id: c.id, base: c.finding ?? c.label, testKey: d.key, testName: d.name, recordOnly: d.kind === 'record_only' });
    }
  }
  const testsByWords = new Map<string, Set<string>>();
  // Posture (record-only) already reads apart with "· posture".
  for (const x of seen) {
    if (x.recordOnly) continue;
    const k = wordsKey(x.base);
    testsByWords.set(k, (testsByWords.get(k) ?? new Set()).add(x.testKey));
  }
  const out: Record<string, string> = {};
  for (const x of seen) {
    const clash = !x.recordOnly && (testsByWords.get(wordsKey(x.base))?.size ?? 0) > 1;
    out[x.id] = clash ? `${x.base} · ${x.testName}` : x.recordOnly ? `${x.base} · posture` : x.base;
  }
  return out;
}

export function observedFindings(tests: readonly FindingsInput[]): Finding[] {
  const labels = checkpointLabelMap(tests.map((t) => t.definition));
  const out: (Finding & { order: number })[] = [];
  let order = 0;
  for (const t of tests) {
    if (t.status !== 'done' && t.status !== 'stopped') continue;
    for (const c of checkpointsOf(t.definition)) {
      order += 1;
      const sides: FindingSide[] = [];
      for (const r of t.results) {
        if (r.checkpointId !== c.id || r.severity === 'normal') continue;
        if (c.sided ? r.side === 'none' : r.side !== 'none') continue;
        sides.push({ side: r.side, severity: r.severity });
      }
      if (sides.length === 0) continue;
      sides.sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side]);
      const recordOnly = t.definition.kind === 'record_only';
      out.push({
        checkpointId: c.id,
        label: labels[c.id] ?? c.finding ?? c.label,
        testKey: t.definition.key,
        testName: t.definition.name,
        recordOnly,
        sides,
        worst: sides.some((s) => s.severity === 'severe') ? 'severe' : 'slight',
        order,
      });
    }
  }
  // Worst first; record-only posture after the movement findings; otherwise test and checkpoint order.
  out.sort((a, b) => Number(a.recordOnly) - Number(b.recordOnly) || Number(b.worst === 'severe') - Number(a.worst === 'severe') || a.order - b.order);
  return out.map((f) => ({
    checkpointId: f.checkpointId,
    label: f.label,
    testKey: f.testKey,
    testName: f.testName,
    recordOnly: f.recordOnly,
    sides: f.sides,
    worst: f.worst,
  }));
}

export type FindingChip = { text: string; severity: Exclude<Severity, 'normal'> };

/** "L · Severe" + "R · Slight", or "L R · Slight" when both sides match, or "Slight" for an unsided checkpoint. */
export function findingChips(f: Pick<Finding, 'sides'>): FindingChip[] {
  const word = (s: FindingSide['severity']) => (s === 'severe' ? 'Severe' : 'Slight');
  const [a, b] = f.sides;
  if (!a) return [];
  if (a.side === 'none') return [{ text: word(a.severity), severity: a.severity }];
  if (b && b.severity === a.severity) return [{ text: `L R · ${word(a.severity)}`, severity: a.severity }];
  return f.sides.map((s) => ({ text: `${s.side} · ${word(s.severity)}`, severity: s.severity }));
}
