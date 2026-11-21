import Link from 'next/link';
import {
  MUSCLE_IDS,
  SLOT_LABELS,
  confirmedGroups,
  confirmedMarks,
  markStates,
  observedFindings,
  regionSideLabel,
  suggestFromFindings,
  type MarkSide,
  type MarkStatus,
  type MuscleId,
  type StoredMark,
} from '@caltracker/shared';
import { ConfirmedFindingsList } from '@/components/assessment-findings/findings-list';
import { FindingsMap } from '@/components/assessment-findings/findings-map';
import { MarkChip, muscleSidesLabel } from '@/components/assessment-findings/labels';
import { ButtonLink, Card } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { checkpointLabels, findingsFrom, loadMarks, loadPicks } from '@/lib/assessment-findings';
import { getClient } from '@/lib/page-data';
import { createServerSupabase } from '@/lib/supabase/server';
import { CompareMapsCard } from './compare-columns';
import type { AssessmentDetail } from './load';
import { assessmentHref } from './links';
import styles from './assessments.module.css';

/**
 * Step 2 in step 3's report (AS6) and Compare (AS7): the coach-confirmed findings. Server components; each loads its
 * own rows by assessment id under the coach's session (RLS) and renders a Card, or null when it has nothing to show.
 *
 *   report:  Priorities (under the score), the confirmed body map (top of the second column), Suggested workout
 *   compare: a body map per column, "Muscles · coach-confirmed" (what changed per muscle and side)
 */

type ReportSlotProps = { clientId: string; assessment: AssessmentDetail };
type CompareSlotProps = { clientId: string; columns: AssessmentDetail[] };

async function marksOf(assessmentId: string): Promise<{ marks: StoredMark[]; checks: Awaited<ReturnType<typeof loadMarks>>['checks'] }> {
  const { workspaceId } = await requireCoach();
  return loadMarks(await createServerSupabase(), workspaceId, assessmentId);
}

/** Muscle groups in the order the findings name them (worst finding first). */
function findingOrder(a: AssessmentDetail): MuscleId[] {
  const findings = observedFindings(a.tests.map((t) => ({ definition: t.definition, status: t.entry.status, results: t.entry.results })));
  return [...new Set(suggestFromFindings(findings).map((s) => s.muscleId))];
}

const PRIORITIES = 5;

/** "What to work on first": the confirmed possibly over / under muscles, worst finding first. */
export async function ReportPriorities({ assessment }: ReportSlotProps) {
  const { marks } = await marksOf(assessment.id);
  const labels = checkpointLabels(assessment.tests.map((t) => t.definition));
  const groups = confirmedGroups(marks, findingOrder(assessment));
  if (groups.length === 0) return null;
  // Underactive and overactive interleaved by the findings' order, not one kind first.
  const order = findingOrder(assessment);
  const place = (id: MuscleId) => (order.indexOf(id) === -1 ? 99 + MUSCLE_IDS.indexOf(id) : order.indexOf(id));
  const top = [...groups].sort((a, b) => place(a.muscleId) - place(b.muscleId)).slice(0, PRIORITIES);
  return (
    <Card className={styles.card} aria-labelledby="priorities-heading" data-testid="report-priorities">
      <h2 id="priorities-heading" className={styles.heading}>What to work on first</h2>
      <ol className={styles.notes}>
        {top.map((g) => (
          <li key={`${g.muscleId}-${g.status}`}>
            <strong data-ph-safe="">{muscleSidesLabel(g.muscleId, g.sides)}</strong> <MarkChip status={g.status} />
            {g.sources.length > 0 ? (
              <span className={styles.caption} data-ph-safe=""> · from {[...new Set(g.sources.map((s) => labels[s] ?? s))].join(', ')}</span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className={styles.caption}>Possible contributors the coach confirmed, not a diagnosis.</p>
    </Card>
  );
}

/** The coach-confirmed body map with its list, and a way back to the findings. */
export async function ReportBodyMap({ clientId, assessment }: ReportSlotProps) {
  const { marks, checks } = await marksOf(assessment.id);
  const f = findingsFrom(marks, checks, checkpointLabels(assessment.tests.map((t) => t.definition)));
  return (
    <Card className={styles.card} aria-labelledby="map-heading" data-testid="summary-findings">
      <div className={styles.cardHead}>
        <h2 id="map-heading" className={styles.heading}>Muscles · coach-confirmed</h2>
        <Link href={`${assessmentHref(clientId, assessment.id)}/findings`} className={styles.moreLink} data-print-hide="">
          Findings
        </Link>
      </div>
      <FindingsMap states={f.states} size="small" label="Confirmed findings" />
      <ConfirmedFindingsList rows={f.rows} checks={f.checks} />
    </Card>
  );
}

/** Suggested workout: what is picked, and "Open in builder" (the exercises screen makes it in the normal builder). */
export async function ReportSuggestedWorkout({ clientId, assessment }: ReportSlotProps) {
  const client = await getClient(clientId);
  if (!client || client.removedAt !== null) return null;
  const { workspaceId } = await requireCoach();
  const supabase = await createServerSupabase();
  const [{ marks }, { picks }] = await Promise.all([loadMarks(supabase, workspaceId, assessment.id), loadPicks(supabase, workspaceId, assessment.id)]);
  if (confirmedGroups(marks).length === 0) return null;
  const n = new Set(picks.map((p) => p.exerciseId)).size;
  return (
    <Card className={styles.card} aria-labelledby="suggested-heading" data-testid="report-suggested" data-print-hide="">
      <h2 id="suggested-heading" className={styles.heading}>Suggested workout</h2>
      <p className={styles.caption}>
        {n > 0 ? `${n} corrective ${n === 1 ? 'exercise' : 'exercises'} picked for the confirmed muscles.` : 'Pick corrective exercises for the confirmed muscles.'}
      </p>
      <ButtonLink href={`${assessmentHref(clientId, assessment.id)}/exercises`} variant="secondary" phSafe>
        {n > 0 ? 'Open in builder' : 'Pick exercises'}
      </ButtonLink>
    </Card>
  );
}

/** A small confirmed body map per assessment of the cycle (on a phone, the two picked: CompareMapsCard). */
export async function CompareBodyMaps({ columns }: CompareSlotProps) {
  const all = await Promise.all(
    columns.map(async (a) => ({ id: a.id, label: SLOT_LABELS[a.slot], states: markStates(confirmedMarks((await marksOf(a.id)).marks)) })),
  );
  if (all.every((c) => Object.keys(c.states).length === 0)) return null;
  return <CompareMapsCard columns={all} />;
}

const STATUS_TEXT: Record<MarkStatus, string> = { over: '↑ Over', under: '↓ Under', normal: '✓ Normal' };

/**
 * "Muscles · coach-confirmed" (AS7 note 3): only confirmed marks, per muscle and side across the cycle, e.g.
 * "Glute max · L R: ↓ Under → ✓ Normal". Both sides share a row when they read the same in every column.
 */
export async function CompareMuscles({ columns }: CompareSlotProps) {
  const states = await Promise.all(columns.map(async (a) => markStates(confirmedMarks((await marksOf(a.id)).marks))));
  const keys = new Set(states.flatMap((s) => Object.keys(s)));
  if (keys.size === 0) return null;
  type Row = { muscleId: MuscleId; sides: MarkSide[]; values: (MarkStatus | null)[] };
  const rows: Row[] = [];
  for (const m of MUSCLE_IDS) {
    const sides: MarkSide[] = keys.has(m) ? ['none'] : (['L', 'R'] as const).filter((s) => keys.has(`${m}.${s}`));
    const valuesOf = (side: MarkSide) => states.map((s) => (s[side === 'none' ? m : `${m}.${side}`]) ?? null);
    if (sides.length === 2 && JSON.stringify(valuesOf('L')) === JSON.stringify(valuesOf('R'))) rows.push({ muscleId: m, sides, values: valuesOf('L') });
    else for (const side of sides) rows.push({ muscleId: m, sides: [side], values: valuesOf(side) });
  }
  return (
    <Card className={styles.card} aria-labelledby="compare-muscles-heading" data-testid="compare-muscles">
      <h2 id="compare-muscles-heading" className={styles.heading}>Muscles · coach-confirmed</h2>
      <table className={styles.measureTable}>
        <thead>
          <tr>
            <th scope="col"><span className={styles.srOnly}>Muscle</span></th>
            {columns.map((a) => (
              <th key={a.id} scope="col">{SLOT_LABELS[a.slot]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.muscleId}-${r.sides.join('')}`}>
              <th scope="row" data-ph-safe="">{r.sides.length === 1 && r.sides[0] !== 'none' ? regionSideLabel(r.muscleId, r.sides[0]!) : muscleSidesLabel(r.muscleId, r.sides)}</th>
              {r.values.map((v, i) => (
                <td key={i}>{v ? STATUS_TEXT[v] : '–'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.caption}>Only what the coach confirmed in Findings. “–”: not marked in that assessment.</p>
    </Card>
  );
}
