'use client';

import Link from 'next/link';
import {
  SLOT_LABELS,
  formatPlainDayMonthInYear,
  movementScore,
  observedFindings,
  type FootArch,
  type MeasureDef,
} from '@caltracker/shared';
import { ConfirmedFindingsList } from '@/components/assessment-findings/findings-list';
import { FindingsMap } from '@/components/assessment-findings/findings-map';
import { ButtonLink, Card, PageHeader } from '@/components/ui';
import type { AssessmentFindings } from '@/lib/assessment-findings';
import { useLocalToday } from '@/lib/local-today';
import type { AssessmentDetail } from './load';
import { FindingsList, ScoreCard } from './parts';
import styles from './assessments.module.css';

const UNIT: Record<MeasureDef['unit'], string> = { cm: ' cm', deg: '°', s: ' s' };
const ARCH: Record<FootArch, string> = { flat: 'Flat', normal: 'Normal', high: 'High' };

/**
 * A finished assessment (step 1 of AS6): the Movement score with a bar per test, what was observed, the numbers, and
 * the notes, and (step 2) the coach-confirmed findings on the body map with a way back to the exercises and the
 * suggested workout. The report layout comes in step 3.
 */
export function SummaryView({
  client,
  assessment,
  findings: confirmed,
  current,
}: {
  client: { id: string; name: string };
  assessment: AssessmentDetail;
  findings: AssessmentFindings;
  current: boolean;
}) {
  const today = useLocalToday();
  const inputs = assessment.tests.map((t) => ({ definition: t.definition, status: t.entry.status, results: t.entry.results }));
  // The stored score is the one saved at the time; the bars use the same rule on the same ratings.
  const scores = movementScore(inputs);
  const names = Object.fromEntries(assessment.tests.map((t) => [t.key, t.definition.name]));
  const findings = observedFindings(inputs);
  const measured = assessment.tests.flatMap((t) =>
    t.definition.measures.map((m) => ({ m, values: t.entry.measures.filter((v) => v.measureId === m.id), skipped: t.entry.status === 'skipped' })),
  );
  const fmt = (m: MeasureDef, v: number | undefined) => (v === undefined ? '–' : `${v}${UNIT[m.unit]}`);
  const notes = assessment.tests.filter((t) => t.entry.note || t.entry.typeDone || t.entry.discomfortLeft || t.entry.discomfortRight || Object.keys(t.entry.followUps).length > 0);
  const title = `${SLOT_LABELS[assessment.slot]} · ${formatPlainDayMonthInYear(assessment.assessedOn, today)}`;

  return (
    <div className={styles.summary} data-testid="assessment-summary">
      <PageHeader title={title} back={{ href: `/clients/${client.id}/limitations`, label: `${client.name} · Limitations & injuries` }} subtitle={`Cycle ${assessment.cycleNumber}`} />
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCol}>
          <ScoreCard score={assessment.score ?? scores.overall} tests={scores.tests} names={names} />
          {measured.length > 0 || assessment.footArchLeft || assessment.footArchRight ? (
            <Card className={styles.card} aria-labelledby="measures-heading">
              <h2 id="measures-heading" className={styles.heading}>Measurements</h2>
              <table className={styles.measureTable}>
                <thead>
                  <tr>
                    <th scope="col"><span className={styles.srOnly}>Measure</span></th>
                    <th scope="col">L</th>
                    <th scope="col">R</th>
                  </tr>
                </thead>
                <tbody>
                  {assessment.footArchLeft || assessment.footArchRight ? (
                    <tr>
                      <th scope="row">Foot arch</th>
                      <td>{assessment.footArchLeft ? ARCH[assessment.footArchLeft] : '–'}</td>
                      <td>{assessment.footArchRight ? ARCH[assessment.footArchRight] : '–'}</td>
                    </tr>
                  ) : null}
                  {measured.map(({ m, values, skipped }) => (
                    <tr key={m.id}>
                      <th scope="row" data-ph-safe="">{m.label}</th>
                      {skipped ? (
                        <td colSpan={2}>Not tested</td>
                      ) : m.sided ? (
                        <>
                          <td>{fmt(m, values.find((v) => v.side === 'L')?.value)}</td>
                          <td>{fmt(m, values.find((v) => v.side === 'R')?.value)}</td>
                        </>
                      ) : (
                        <td colSpan={2}>{fmt(m, values[0]?.value)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </div>
        <div className={styles.summaryCol}>
          <Card className={styles.card} aria-labelledby="map-heading" data-testid="summary-findings">
            <div className={styles.cardHead}>
              <h2 id="map-heading" className={styles.heading}>Findings</h2>
              <Link href={`/clients/${client.id}/assessments/${assessment.id}/findings`} className={styles.moreLink}>Review</Link>
            </div>
            <FindingsMap states={confirmed.states} size="small" label="Confirmed findings" />
            <ConfirmedFindingsList rows={confirmed.rows} checks={confirmed.checks} />
            {current ? (
              <ButtonLink href={`/clients/${client.id}/assessments/${assessment.id}/exercises`} variant="secondary" phSafe>
                Exercises and suggested workout
              </ButtonLink>
            ) : null}
          </Card>
          <Card className={styles.card} aria-labelledby="observed-heading">
            <h2 id="observed-heading" className={styles.heading}>Observed</h2>
            <FindingsList findings={findings} />
          </Card>
          {notes.length > 0 || assessment.note ? (
            <Card className={styles.card} aria-labelledby="notes-heading">
              <h2 id="notes-heading" className={styles.heading}>Notes</h2>
              <ul className={styles.notes}>
                {assessment.note ? <li>{assessment.note}</li> : null}
                {notes.map((t) => {
                  const parts = [
                    t.entry.typeDone ? `Type done: ${t.entry.typeDone}` : null,
                    t.entry.discomfortLeft || t.entry.discomfortRight
                      ? `Discomfort reported: ${[t.entry.discomfortLeft ? 'L' : null, t.entry.discomfortRight ? 'R' : null].filter(Boolean).join(' ')}`
                      : null,
                    ...t.definition.followUps.map((f) => {
                      const v = t.entry.followUps[f.id];
                      const o = f.options.find((x) => x.value === v);
                      return o ? `${f.label}: ${o.label}` : null;
                    }),
                    t.entry.note || null,
                  ].filter(Boolean);
                  return (
                    <li key={t.id}>
                      <strong data-ph-safe="">{t.definition.name}</strong>
                      {t.entry.status === 'stopped' ? ' (stopped)' : ''}: {parts.join(' · ')}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
