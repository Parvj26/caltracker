import { MUSCLE_GROUPS, MUSCLE_IDS, isMuscleId, regionSides, type MuscleId } from '../anatomy/muscles';
import { observedFindings, type Finding, type FindingsInput } from './findings';
import { ALSO_CHECKS, ALSO_CHECK_IDS, findingRule, type AlsoCheckId } from './rules';

/**
 * Muscle marks (step 2, board AS4): what the coach thinks may be going on, per muscle group and side.
 *
 * The app suggests marks from what was observed (suggestMarks, from FINDING_RULES). Nothing is stored for a suggestion
 * until the coach acts on it: ✓ confirms it, × rejects it, Change picks Over / Under / Normal, and the body map or
 * "+ Add muscle" adds one by hand. Only CONFIRMED marks colour the map, feed the exercise options and go in the report.
 * A stored mark keeps the checkpoints it came from (`sources`), so the report can say "from Knees cave in" even if the
 * rules change later.
 */

export const MARK_STATUSES = ['over', 'under', 'normal'] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];

export const MARK_REVIEWS = ['confirmed', 'rejected'] as const;
export type MarkReview = (typeof MARK_REVIEWS)[number];

/** 'L' / 'R', or 'none' for a one-piece region (abs). */
export type MarkSide = 'L' | 'R' | 'none';

/** One mark as stored (assessment_muscle_marks). */
export type StoredMark = { muscleId: MuscleId; side: MarkSide; status: MarkStatus; review: MarkReview; sources: string[] };

/** A finding a mark came from: its checkpoint id and the words the coach saw ("Knees cave in"). */
export type MarkSource = { checkpointId: string; label: string };

export type SuggestedMark = {
  muscleId: MuscleId;
  side: MarkSide;
  status: 'over' | 'under';
  sources: MarkSource[];
  /** Other findings pointed the other way (outvoted, or a tie lost to the worse finding). */
  against: MarkSource[];
};

const SIDE_ORDER: Record<MarkSide, number> = { L: 0, R: 1, none: 2 };
const MUSCLE_ORDER = new Map<string, number>(MUSCLE_IDS.map((id, i) => [id, i]));
export const markKey = (muscleId: string, side: MarkSide) => (side === 'none' ? muscleId : `${muscleId}.${side}`);

/** The sides a finding on `side` touches on a muscle: its own side, both for an unsided finding, 'none' for abs. */
function sidesFor(muscleId: MuscleId, side: 'L' | 'R' | 'none'): MarkSide[] {
  if (regionSides(muscleId)[0] === 'none') return ['none'];
  return side === 'none' ? ['L', 'R'] : [side];
}

/**
 * The app's suggestions from what was observed: every muscle group and side a finding points at, possibly over or
 * under. When findings disagree on one muscle and side, the one with more findings wins; a tie goes to the worse
 * finding (findings come worst first). Record-only posture suggests nothing. Order: the order findings name them.
 */
export function suggestMarks(tests: readonly FindingsInput[]): SuggestedMark[] {
  return suggestFromFindings(observedFindings(tests));
}

export function suggestFromFindings(findings: readonly Finding[]): SuggestedMark[] {
  type Votes = { muscleId: MuscleId; side: MarkSide; first: 'over' | 'under'; over: MarkSource[]; under: MarkSource[] };
  const votes = new Map<string, Votes>();
  for (const f of findings) {
    if (f.recordOnly) continue;
    const rule = findingRule(f.checkpointId);
    if (!rule) continue;
    const source: MarkSource = { checkpointId: f.checkpointId, label: f.label };
    for (const [status, muscles] of [['over', rule.over], ['under', rule.under]] as const) {
      for (const m of muscles) {
        for (const fs of f.sides) {
          for (const side of sidesFor(m, fs.side)) {
            const key = markKey(m, side);
            let v = votes.get(key);
            if (!v) {
              v = { muscleId: m, side, first: status, over: [], under: [] };
              votes.set(key, v);
            }
            if (!v[status].some((s) => s.checkpointId === source.checkpointId)) v[status].push(source);
          }
        }
      }
    }
  }
  return [...votes.values()].map((v) => {
    const status = v.over.length > v.under.length ? 'over' : v.under.length > v.over.length ? 'under' : v.first;
    return { muscleId: v.muscleId, side: v.side, status, sources: v[status], against: v[status === 'over' ? 'under' : 'over'] };
  });
}

export type ReviewRow = {
  muscleId: MuscleId;
  side: MarkSide;
  status: MarkStatus;
  /** 'pending': suggested, not yet confirmed or rejected. */
  review: MarkReview | 'pending';
  sources: MarkSource[];
  against: MarkSource[];
  /** 'suggested' by the app, or added by the coach (map, "+ Add muscle"). */
  origin: 'suggested' | 'coach';
};

/**
 * The review list: every suggestion with the coach's decision on it, plus the marks the coach added. A stored mark
 * on a suggested muscle and side wins (its status and review); a suggestion with nothing stored is pending.
 * `labels` names the checkpoints of stored sources (from the assessment's own definitions).
 */
export function reviewRows(suggested: readonly SuggestedMark[], stored: readonly StoredMark[], labels: Readonly<Record<string, string>> = {}): ReviewRow[] {
  const byKey = new Map(stored.map((m) => [markKey(m.muscleId, m.side), m]));
  const rows: ReviewRow[] = suggested.map((s) => {
    const m = byKey.get(markKey(s.muscleId, s.side));
    byKey.delete(markKey(s.muscleId, s.side));
    return {
      muscleId: s.muscleId,
      side: s.side,
      status: m?.status ?? s.status,
      review: m?.review ?? 'pending',
      sources: s.sources,
      against: s.against,
      origin: 'suggested',
    };
  });
  for (const m of byKey.values()) {
    rows.push({
      muscleId: m.muscleId,
      side: m.side,
      status: m.status,
      review: m.review,
      sources: m.sources.map((id) => ({ checkpointId: id, label: labels[id] ?? id })),
      against: [],
      origin: 'coach',
    });
  }
  return rows;
}

export type ReviewGroup = {
  muscleId: MuscleId;
  status: MarkStatus;
  /** One per side, L before R. */
  rows: ReviewRow[];
  sources: MarkSource[];
  against: MarkSource[];
};

/**
 * The list's rows (board AS4): one per muscle and status, its sides inside ("Adductors ↑ Over · L ✓ R ✓"). Sections
 * Over, Under, then Normal. Within a section the order findings named them, the coach's own after.
 */
export function reviewGroups(rows: readonly ReviewRow[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup & { order: number }>();
  rows.forEach((r, i) => {
    const key = `${r.muscleId}|${r.status}`;
    let g = groups.get(key);
    if (!g) {
      g = { muscleId: r.muscleId, status: r.status, rows: [], sources: [], against: [], order: i };
      groups.set(key, g);
    }
    g.rows.push(r);
    for (const s of r.sources) if (!g.sources.some((x) => x.checkpointId === s.checkpointId)) g.sources.push(s);
    for (const s of r.against) if (!g.against.some((x) => x.checkpointId === s.checkpointId)) g.against.push(s);
  });
  const rank: Record<MarkStatus, number> = { over: 0, under: 1, normal: 2 };
  return [...groups.values()]
    .sort((a, b) => rank[a.status] - rank[b.status] || a.order - b.order)
    .map(({ order: _order, ...g }) => ({ ...g, rows: [...g.rows].sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side]) }));
}

/** The marks the coach confirmed, in catalogue order (the report and the map read these). */
export function confirmedMarks(marks: readonly StoredMark[]): StoredMark[] {
  return marks
    .filter((m) => m.review === 'confirmed')
    .sort((a, b) => (MUSCLE_ORDER.get(a.muscleId) ?? 99) - (MUSCLE_ORDER.get(b.muscleId) ?? 99) || SIDE_ORDER[a.side] - SIDE_ORDER[b.side]);
}

/** Body-map states (BodyMap `states`), keyed `glute_medius.L` / `abs`, from the confirmed marks only. */
export function markStates(marks: readonly Pick<StoredMark, 'muscleId' | 'side' | 'status' | 'review'>[]): Record<string, MarkStatus> {
  const out: Record<string, MarkStatus> = {};
  for (const m of marks) if (m.review === 'confirmed') out[markKey(m.muscleId, m.side)] = m.status;
  return out;
}

export type ConfirmedGroup = { muscleId: MuscleId; status: 'over' | 'under'; sides: MarkSide[]; sources: string[] };

/**
 * Confirmed over / under marks grouped by muscle and status (board AS5: one exercise group per confirmed muscle, "L R").
 * Underactive groups first (as on the board), then overactive, each in `order` (the review list's order of muscles)
 * and then catalogue order. Normal marks need no exercise.
 */
export function confirmedGroups(marks: readonly StoredMark[], order: readonly MuscleId[] = []): ConfirmedGroup[] {
  const groups = new Map<string, ConfirmedGroup>();
  for (const m of marks) {
    if (m.review !== 'confirmed' || m.status === 'normal') continue;
    const key = `${m.muscleId}|${m.status}`;
    const g = groups.get(key) ?? { muscleId: m.muscleId, status: m.status, sides: [], sources: [] };
    if (!g.sides.includes(m.side)) g.sides.push(m.side);
    for (const s of m.sources) if (!g.sources.includes(s)) g.sources.push(s);
    groups.set(key, g);
  }
  const place = (id: MuscleId) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length + (MUSCLE_ORDER.get(id) ?? 99) : i;
  };
  return [...groups.values()]
    .map((g) => ({ ...g, sides: [...g.sides].sort((a, b) => SIDE_ORDER[a] - SIDE_ORDER[b]) }))
    .sort((a, b) => Number(a.status === 'over') - Number(b.status === 'over') || place(a.muscleId) - place(b.muscleId));
}

export type AlsoCheck = { id: AlsoCheckId; label: string; from: string[] };

/** "Also check" (board AS4): what is worth checking first, each with the findings that raised it. */
export function alsoChecks(findings: readonly Finding[]): AlsoCheck[] {
  const out = new Map<AlsoCheckId, AlsoCheck>();
  for (const f of findings) {
    if (f.recordOnly) continue;
    for (const id of findingRule(f.checkpointId)?.checks ?? []) {
      const c = out.get(id) ?? { id, label: ALSO_CHECKS[id], from: [] };
      if (!c.from.includes(f.label)) c.from.push(f.label);
      out.set(id, c);
    }
  }
  return [...out.values()];
}

/** Possible contributors with no region on the map, per finding ("Serratus anterior"), for the review list. */
export function alsoConsider(findings: readonly Finding[]): { label: string; from: string[] }[] {
  const out = new Map<string, string[]>();
  for (const f of findings) {
    if (f.recordOnly) continue;
    for (const name of findingRule(f.checkpointId)?.alsoConsider ?? []) {
      const from = out.get(name) ?? [];
      if (!from.includes(f.label)) from.push(f.label);
      out.set(name, from);
    }
  }
  return [...out.entries()].map(([label, from]) => ({ label, from }));
}

export const MAX_MARKS = MUSCLE_GROUPS.length * 2;
const CHECKPOINT_ID = /^[a-z]+\.[a-z0-9_]+$/;

/** The marks a save sends, checked (the database checks again), or null when anything is off. */
export function checkMarks(input: unknown): StoredMark[] | null {
  if (!Array.isArray(input) || input.length > MAX_MARKS) return null;
  const seen = new Set<string>();
  const out: StoredMark[] = [];
  for (const raw of input as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null;
    const m = raw as Record<string, unknown>;
    if (!isMuscleId(m.muscleId)) return null;
    const sides = regionSides(m.muscleId);
    if (typeof m.side !== 'string' || !(sides as readonly string[]).includes(m.side)) return null;
    if (!(MARK_STATUSES as readonly unknown[]).includes(m.status) || !(MARK_REVIEWS as readonly unknown[]).includes(m.review)) return null;
    if (!Array.isArray(m.sources) || m.sources.length > 10 || !m.sources.every((s) => typeof s === 'string' && CHECKPOINT_ID.test(s))) return null;
    const key = markKey(m.muscleId, m.side as MarkSide);
    if (seen.has(key)) return null;
    seen.add(key);
    out.push({ muscleId: m.muscleId, side: m.side as MarkSide, status: m.status as MarkStatus, review: m.review as MarkReview, sources: [...new Set(m.sources as string[])] });
  }
  return out;
}

/** Ticked "Also check" ids, checked. */
export function checkAlsoCheckIds(input: unknown): AlsoCheckId[] | null {
  if (!Array.isArray(input) || input.length > ALSO_CHECK_IDS.length) return null;
  if (!input.every((id) => typeof id === 'string' && (ALSO_CHECK_IDS as readonly string[]).includes(id))) return null;
  return [...new Set(input as AlsoCheckId[])];
}
