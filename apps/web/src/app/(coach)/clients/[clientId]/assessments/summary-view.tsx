'use client';

import {
  SLOT_LABELS,
  formatPlainDayMonthInYear,
  movementScore,
  observedFindings,
  type FootArch,
  type MeasureDef,
} from '@caltracker/shared';
import type { ReactNode } from 'react';
import { Button, ButtonLink, Card, PageHeader } from '@/components/ui';
import { useLocalToday } from '@/lib/local-today';
import type { AssessmentDetail } from './load';
import { FindingsList, ScoreCard } from './parts';
import styles from './assessments.module.css';

const UNIT: Record<MeasureDef['unit'], string> = { cm: ' cm', deg: '°', s: ' s' };
const ARCH: Record<FootArch, string> = { flat: 'Flat', normal: 'Normal', high: 'High' };

/** Step 2's parts of the report (step2-slots.tsx), rendered by the page on the server; each may be empty. */
export type ReportSlots = { priorities?: ReactNode; bodyMap?: ReactNode; suggestedWorkout?: ReactNode };

/**
 * The report of a finished assessment (AS6): the Movement score with a bar per test, what was observed (L / R), the
 * numbers, the notes, and who did it when. Prints as one clean column (Print, or the browser's own print). Step 2's
 * priorities, body map and suggested workout go in `slots`. Sharing it with the client is step 5 (client app).
 */
export function SummaryView({
  client,
  assessment,
  compareHref,
  slots = {},
}: {
  client: { id: string; name: string };
  assessment: AssessmentDetail;
  /** Compare this cycle (two or more finished). */
  compareHref?: string | null;
  slots?: ReportSlots;
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
  const day = formatPlainDayMonthInYear(assessment.assessedOn, today);
  const title = `${SLOT_LABELS[assessment.slot]} · ${day}`;
  const byline = `Cycle ${assessment.cycleNumber} · ${assessment.coachName ? `Checked by ${assessment.coachName} on ${day}` : `Checked on ${day}`}`;

  return (
    <div className={styles.summary} data-testid="assessment-summary">
      <PageHeader
        title={title}
        back={{ href: `/clients/${client.id}/limitations`, label: `${client.name} · Limitations & injuries` }}
        subtitle={byline}
        stackOnPhone
        action={
          <span className={styles.headerActions} data-print-hide="">
            {compareHref ? (
              <ButtonLink href={compareHref} variant="secondary" size="compact" phSafe>
                Compare
              </ButtonLink>
            ) : null}
            <Button variant="secondary" size="compact" onClick={() => window.print()} phSafe>
              Print
            </Button>
          </span>
        }
      />
      {/* Printed only: the client's name, which the screen shows in the back link (hidden on paper). */}
      <p className={styles.printOnly}>
        {client.name} · Movement assessment
      </p>
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCol}>
          <ScoreCard score={assessment.score ?? scores.overall} tests={scores.tests} names={names} />
          {slots.priorities}
          <Card className={styles.card} aria-labelledby="observed-heading">
            <h2 id="observed-heading" className={styles.heading}>Observed</h2>
            <FindingsList findings={findings} />
          </Card>
        </div>
        <div className={styles.summaryCol}>
          {slots.bodyMap}
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
          {slots.suggestedWorkout}
        </div>
      </div>
    </div>
  );
}
