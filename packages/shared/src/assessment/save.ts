import { checkpointsOf } from './score';
import { SEVERITIES, TEST_STATUSES, type CheckpointResult, type MeasureResult, type Severity, type Side, type TestDefinition, type TestStatus } from './types';

/**
 * What the coach entered for one test, checked against the definition the assessment was started with. The server
 * action runs this before saving, so only known checkpoints, sides, options and in-range numbers reach the database.
 */

export const TEST_NOTE_MAX = 1000;
export const TYPE_DONE_MAX = 120;
export const ASSESSMENT_NOTE_MAX = 1000;

export type TestEntry = {
  status: TestStatus;
  results: CheckpointResult[];
  measures: MeasureResult[];
  /** Follow-up id → chosen option value. */
  followUps: Record<string, string>;
  discomfortLeft: boolean;
  discomfortRight: boolean;
  typeDone: string;
  note: string;
};

/** A blank entry: every checkpoint Normal, nothing measured. */
export function emptyEntry(): TestEntry {
  return { status: 'pending', results: [], measures: [], followUps: {}, discomfortLeft: false, discomfortRight: false, typeDone: '', note: '' };
}

const sidesFor = (sided: boolean): Side[] => (sided ? ['L', 'R'] : ['none']);

/**
 * Checks and tidies an entry. Ratings come back as the full grid (every checkpoint and side of the definition, Normal
 * where untouched), so the stored rows say exactly what was observed. Returns null when anything is not valid.
 */
export function checkTestEntry(definition: TestDefinition, input: unknown): TestEntry | null {
  if (typeof input !== 'object' || input === null) return null;
  const e = input as Record<string, unknown>;
  if (typeof e.status !== 'string' || !(TEST_STATUSES as readonly string[]).includes(e.status)) return null;
  if (!Array.isArray(e.results) || !Array.isArray(e.measures)) return null;
  if (typeof e.followUps !== 'object' || e.followUps === null || Array.isArray(e.followUps)) return null;
  if (typeof e.discomfortLeft !== 'boolean' || typeof e.discomfortRight !== 'boolean') return null;
  if (typeof e.typeDone !== 'string' || typeof e.note !== 'string') return null;

  // Ratings.
  const checkpoints = new Map(checkpointsOf(definition).map((c) => [c.id, c]));
  const rated = new Map<string, Severity>();
  for (const r of e.results as unknown[]) {
    if (typeof r !== 'object' || r === null) return null;
    const { checkpointId, side, severity } = r as Record<string, unknown>;
    const c = typeof checkpointId === 'string' ? checkpoints.get(checkpointId) : undefined;
    if (!c || typeof side !== 'string' || !sidesFor(c.sided).includes(side as Side)) return null;
    if (typeof severity !== 'string' || !(SEVERITIES as readonly string[]).includes(severity)) return null;
    rated.set(`${c.id}|${side}`, severity as Severity);
  }
  const results: CheckpointResult[] = [];
  for (const c of checkpoints.values()) {
    for (const side of sidesFor(c.sided)) results.push({ checkpointId: c.id, side, severity: rated.get(`${c.id}|${side}`) ?? 'normal' });
  }

  // Numbers: only what was typed; a blank field is simply not sent.
  const defs = new Map(definition.measures.map((m) => [m.id, m]));
  const measured = new Map<string, MeasureResult>();
  for (const m of e.measures as unknown[]) {
    if (typeof m !== 'object' || m === null) return null;
    const { measureId, side, value } = m as Record<string, unknown>;
    const d = typeof measureId === 'string' ? defs.get(measureId) : undefined;
    if (!d || typeof side !== 'string' || !sidesFor(d.sided).includes(side as Side)) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < d.min || value > d.max) return null;
    measured.set(`${d.id}|${side}`, { measureId: d.id, side: side as Side, value: Math.round(value * 10) / 10 });
  }

  const followUps: Record<string, string> = {};
  for (const [id, value] of Object.entries(e.followUps as Record<string, unknown>)) {
    const f = definition.followUps.find((x) => x.id === id);
    if (!f || typeof value !== 'string' || !f.options.some((o) => o.value === value)) return null;
    // An answer to a question no longer asked (its checkpoint went back to Normal) is dropped.
    if (results.some((r) => r.checkpointId === f.after && r.severity !== 'normal')) followUps[id] = value;
  }

  const typeDone = e.typeDone.trim();
  if (typeDone.length > TYPE_DONE_MAX || (typeDone && !definition.typeDone)) return null;
  const note = e.note.trim();
  if (note.length > TEST_NOTE_MAX) return null;

  return {
    status: e.status as TestStatus,
    results,
    measures: [...measured.values()],
    followUps,
    discomfortLeft: e.discomfortLeft,
    discomfortRight: e.discomfortRight,
    typeDone,
    note,
  };
}

/** A follow-up is asked only while its checkpoint is Slight or Severe on some side. */
export function followUpShown(definition: TestDefinition, followUpId: string, results: readonly CheckpointResult[]): boolean {
  const f = definition.followUps.find((x) => x.id === followUpId);
  return !!f && results.some((r) => r.checkpointId === f.after && r.severity !== 'normal');
}
