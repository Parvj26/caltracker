import type { AssessmentSlot } from './types';

/**
 * A client's assessment cycles (board AS1): each cycle has Initial → Retest 1 → optional Retest 2. Once Retest 1 is
 * done the coach may start a new cycle; older cycles stay, read-only. The database enforces the same order
 * (start_assessment); this decides what the cycle card shows.
 */

/** Weeks between one assessment and the next (content draft: 4–8, Luis to confirm; the boards show 4). */
export const RETEST_INTERVAL_DAYS = 28;

export const SLOT_LABELS: Record<AssessmentSlot, string> = {
  initial: 'Initial',
  retest_1: 'Retest 1',
  retest_2: 'Retest 2',
};

export type AssessmentSummary = {
  id: string;
  slot: AssessmentSlot;
  status: 'draft' | 'done';
  /** YYYY-MM-DD, the day it was done (or started, for a draft). */
  assessedOn: string;
  score: number | null;
};

export type CycleSummary = { id: string; number: number; assessments: AssessmentSummary[] };

export type SlotState =
  | { slot: AssessmentSlot; state: 'done'; assessment: AssessmentSummary }
  | { slot: AssessmentSlot; state: 'draft'; assessment: AssessmentSummary }
  /** The next one to do. `dueOn` (YYYY-MM-DD) for retests; null for an Initial ("Due now"). */
  | { slot: AssessmentSlot; state: 'due'; dueOn: string | null }
  /** Retest 2 once Retest 1 is done: may be started, or left. */
  | { slot: AssessmentSlot; state: 'optional' }
  /** Not yet: the slot before it isn't done. */
  | { slot: AssessmentSlot; state: 'waiting' };

export type CycleView = {
  /** The cycle the card shows: the newest, or null before the first assessment. */
  current: CycleSummary | null;
  /** What the card numbers it ("Cycle 1" before anything exists). */
  number: number;
  slots: SlotState[];
  /** Older cycles, newest first. */
  past: CycleSummary[];
  /** "+ New cycle" (and Compare) show once Retest 1 is done and nothing is half-done. */
  canStartNewCycle: boolean;
  /** The newest finished assessment of the current cycle, for the findings card under it. */
  latestDone: AssessmentSummary | null;
};

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function slotsOf(cycle: CycleSummary | null): SlotState[] {
  const find = (slot: AssessmentSlot) => cycle?.assessments.find((a) => a.slot === slot) ?? null;
  const initial = find('initial');
  const retest1 = find('retest_1');
  const retest2 = find('retest_2');
  const started = (a: AssessmentSummary | null, slot: AssessmentSlot): SlotState | null =>
    a ? (a.status === 'done' ? { slot, state: 'done', assessment: a } : { slot, state: 'draft', assessment: a }) : null;

  const first: SlotState = started(initial, 'initial') ?? { slot: 'initial', state: 'due', dueOn: null };
  const second: SlotState =
    started(retest1, 'retest_1') ??
    (initial?.status === 'done' ? { slot: 'retest_1', state: 'due', dueOn: addDays(initial.assessedOn, RETEST_INTERVAL_DAYS) } : { slot: 'retest_1', state: 'waiting' });
  const third: SlotState = started(retest2, 'retest_2') ?? (retest1?.status === 'done' ? { slot: 'retest_2', state: 'optional' } : { slot: 'retest_2', state: 'waiting' });
  return [first, second, third];
}

export function cycleView(cycles: readonly CycleSummary[]): CycleView {
  const sorted = [...cycles].sort((a, b) => b.number - a.number);
  const current = sorted[0] ?? null;
  const slots = slotsOf(current);
  const done = slots.flatMap((s) => (s.state === 'done' ? [s.assessment] : []));
  const retest1Done = slots[1]?.state === 'done';
  const anyDraft = slots.some((s) => s.state === 'draft');
  return {
    current,
    number: current?.number ?? 1,
    slots,
    past: sorted.slice(1),
    canStartNewCycle: retest1Done && !anyDraft,
    latestDone: done[done.length - 1] ?? null,
  };
}

/** Whether the coach may start `slot` now (in the current cycle, or as the Initial of a new cycle). */
export function canStart(view: CycleView, slot: AssessmentSlot, newCycle: boolean): boolean {
  if (newCycle) return slot === 'initial' && (view.current === null || view.canStartNewCycle);
  const s = view.slots.find((x) => x.slot === slot);
  return s?.state === 'due' || s?.state === 'optional';
}
