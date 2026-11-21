'use client';

import { useId, useState, type ReactNode } from 'react';
import {
  SLOT_LABELS,
  compareAssessments,
  orderColumnPicks,
  formatMeasureDelta,
  formatMeasureValue,
  formatPlainDayMonthInYear,
  formatScoreDelta,
  scoreBand,
  type CompareAssessment,
  type CompareFindingRow,
  type CompareMeasureRow,
  type CompareScoreCell,
  type CompareValue,
  type FindingChange,
  type MeasureChange,
} from '@caltracker/shared';
import { Button, Card, PageHeader } from '@/components/ui';
import { useLocalToday } from '@/lib/local-today';
import { useMediaQuery } from '@/lib/use-media-query';
import type { AssessmentDetail, AssessmentTemplate, LibraryTest } from './load';
import { CompareColumnsContext } from './compare-columns';
import { StartDialog } from './start-dialog';
import styles from './assessments.module.css';

/** Step 2's parts of Compare (step2-slots.tsx), rendered by the page on the server; each may be empty. */
export type CompareSlots = { bodyMaps?: ReactNode; muscles?: ReactNode };

/** What's needed to start Retest 2 from its empty column, when it can be started. */
export type StartRetest2 = { library: LibraryTest[]; templates: AssessmentTemplate[]; initialKeys: string[] };

const VALUE_WORD: Record<CompareValue, string> = { normal: 'Normal', slight: 'Slight', severe: 'Severe', not_tested: 'Not tested' };
const CHANGE_WORD: Record<FindingChange | MeasureChange, string> = {
  improved: 'Improved',
  same: 'Same',
  new: 'New',
  worse: 'Worse',
  not_tested: 'Not tested',
  stopped: 'Stopped',
};
const NOTHING_SEEN = 'Nothing seen in either: every checkpoint was Normal.';
const SIDE_TEXT = { L: ' · L', R: ' · R', LR: ' · L R', none: '' } as const;

function toCompare(a: AssessmentDetail): CompareAssessment {
  return {
    id: a.id,
    slot: a.slot,
    assessedOn: a.assessedOn,
    score: a.score,
    tests: a.tests.map((t) => ({ definition: t.definition, status: t.entry.status, results: t.entry.results, measures: t.measures })),
  };
}

function scoreCellText(c: CompareScoreCell): string {
  if (c.score !== null) return String(c.score);
  if (c.notScored === 'record_only') return 'Not scored · record only';
  if (c.notScored === 'measured') return 'Not scored · measured';
  if (c.notScored === 'stopped') return 'Stopped';
  return 'Not tested';
}

/**
 * Compare (AS7): the assessments of one cycle side by side. A phone compares two at a time (either box picks which);
 * iPad and desktop show all three columns, Retest 2 as an empty column (with Start while it can be started). The
 * score with its change, then every finding joined on checkpoint and side (Improved / Same / New / Worse, Not tested
 * left out of the counts), then the measurements read with their unit and which way is better.
 */
export function CompareView({
  client,
  cycleNumber,
  done,
  retest2,
  readOnly,
  slots = {},
}: {
  client: { id: string; name: string };
  cycleNumber: number;
  /** The cycle's finished assessments in slot order (two or three). */
  done: AssessmentDetail[];
  /** Retest 2 isn't done: its column shows "Not done", with Start when `retest2` is given. Null once it is done. */
  retest2: { canStart: StartRetest2 | null } | null;
  readOnly: boolean;
  slots?: CompareSlots;
}) {
  const today = useLocalToday();
  const phone = useMediaQuery('(max-width: 599.98px)');
  const [pick, setPick] = useState<[number, number]>([0, done.length - 1]);
  const [starting, setStarting] = useState(false);
  const day = (iso: string) => formatPlainDayMonthInYear(iso, today);
  // Always earlier → later, whichever box picked which: Compare reads changes from the first column to the last.
  const shown = phone ? orderColumnPicks(pick).map((i) => done[i]!) : done;
  const valueCols = done.length + (retest2 ? 1 : 0);
  const c = compareAssessments(shown.map(toCompare));
  const names = shown.map((a) => SLOT_LABELS[a.slot]);
  const [o1, o2] = [c.overall.values[0] ?? null, c.overall.values[c.overall.values.length - 1] ?? null];

  const findingCounts = (
    <span className={styles.countChips} data-testid="finding-counts">
      <span className={styles.changeChip} data-change="improved">{c.findingCounts.improved} improved</span>
      <span className={styles.changeChip} data-change="same">{c.findingCounts.same} same</span>
      <span className={styles.changeChip} data-change="new">{c.findingCounts.new} new</span>
      <span className={styles.changeChip} data-change="worse">{c.findingCounts.worse} worse</span>
    </span>
  );
  const measureCounts = (
    <span className={styles.countChips} data-testid="measure-counts">
      {c.measureCounts.improved > 0 ? <span className={styles.changeChip} data-change="improved">{c.measureCounts.improved} improved</span> : null}
      {c.measureCounts.same > 0 ? <span className={styles.changeChip} data-change="same">{c.measureCounts.same} same</span> : null}
      {c.measureCounts.worse > 0 ? <span className={styles.changeChip} data-change="worse">{c.measureCounts.worse} worse</span> : null}
    </span>
  );

  return (
    <div className={styles.compare} data-testid="assessment-compare">
      <PageHeader title={`Compare · Cycle ${cycleNumber}`} back={{ href: `/clients/${client.id}/limitations`, label: `${client.name} · Limitations & injuries` }} />

      {phone ? (
        <div className={styles.comparePickers}>
          {([0, 1] as const).map((i) => (
            <ColumnPicker
              key={i}
              label={i === 0 ? 'Compare from' : 'Compare with'}
              value={pick[i]}
              options={done.map((a, j) => ({ value: j, label: `${SLOT_LABELS[a.slot]} · ${day(a.assessedOn)}`, disabled: j === pick[i === 0 ? 1 : 0] }))}
              onChange={(v) => setPick((p) => orderColumnPicks(i === 0 ? [v, p[1]] : [p[0], v]))}
            />
          ))}
        </div>
      ) : null}

      <Card className={styles.card} aria-labelledby="compare-score-heading" data-testid="compare-score">
        <div className={styles.scoreHead}>
          <h2 id="compare-score-heading" className={styles.heading}>Movement score</h2>
          <p className={styles.caption}>{names.join(' → ')}</p>
        </div>
        <div className={styles.compareScoreGrid}>
          <div>
            <p className={styles.scoreLine}>
              <span className={styles.compareScoreNumber} data-testid="compare-overall">
                {c.overall.values.map((v) => (v === null ? '–' : String(v))).join(' → ')}
              </span>
              {c.overall.delta !== null ? (
                <span className={styles.deltaChip} data-change={c.overall.delta > 0 ? 'improved' : c.overall.delta < 0 ? 'worse' : 'same'} data-testid="compare-overall-delta">
                  {formatScoreDelta(c.overall.delta)}
                </span>
              ) : null}
            </p>
            {c.overall.sameTests ? (
              // The change above is like-for-like: only the tests scored at both ends.
              <p className={styles.caption} data-testid="compare-same-tests">
                Same tests: {c.overall.sameTests.from} → {c.overall.sameTests.to}
              </p>
            ) : null}
            {o1 !== null && o2 !== null ? (
              <p className={styles.bandLine} data-ph-safe="">
                <span className={styles.band} data-band={scoreBand(o1).id}>{scoreBand(o1).label}</span>
                <span aria-hidden="true">→</span>
                <span className={styles.srOnly}>to</span>
                <span className={styles.band} data-band={scoreBand(o2).id}>{scoreBand(o2).label}</span>
              </p>
            ) : null}
          </div>
          <ul className={styles.compareTests} aria-label="Score per test">
            {c.tests.map((t) => {
              const scored = t.cells.some((x) => x.score !== null);
              return (
                <li key={t.key} className={styles.compareTest}>
                  <span className={styles.barName} data-ph-safe="">{t.name}</span>
                  <span className={styles.compareTestValues}>
                    {scored ? t.cells.map(scoreCellText).join(' → ') : scoreCellText(t.cells.find((x) => x.notScored !== 'not_in_assessment') ?? t.cells[0]!)}
                  </span>
                  {t.delta !== null ? (
                    <span className={styles.deltaChip} data-change={t.delta > 0 ? 'improved' : t.delta < 0 ? 'worse' : 'same'}>
                      {formatScoreDelta(t.delta)}
                    </span>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </Card>

      <CompareColumnsContext.Provider value={shown.map((a) => a.id)}>{slots.bodyMaps}</CompareColumnsContext.Provider>

      {phone ? (
        <>
          <section className={styles.compareSection} aria-labelledby="compare-findings-heading">
            <div className={styles.compareSectionHead}>
              <h2 id="compare-findings-heading" className={styles.kicker}>Findings</h2>
              {findingCounts}
            </div>
            {c.findings.length === 0 ? (
              <p className={styles.caption}>{NOTHING_SEEN}</p>
            ) : (
              <ul className={styles.compareList} aria-label="Findings">
                {c.findings.map((f) => (
                  <FindingItem key={`${f.checkpointId}-${f.side}`} row={f} />
                ))}
              </ul>
            )}
          </section>
          {c.measures.length > 0 ? (
            <section className={styles.compareSection} aria-labelledby="compare-measures-heading">
              <div className={styles.compareSectionHead}>
                <h2 id="compare-measures-heading" className={styles.kicker}>Measurements</h2>
                {measureCounts}
              </div>
              <ul className={styles.compareList} aria-label="Measurements">
                {c.measures.map((m) => (
                  <MeasureItem key={`${m.measureId}-${m.side}`} row={m} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        // One table, so every value sits under its column's header card (Initial · Retest 1 · Retest 2 · Change).
        <table className={styles.compareTable} data-testid="compare-table">
          <caption className={styles.srOnly}>Findings and measurements, by assessment</caption>
          <colgroup>
            <col className={styles.colLabel} />
            {Array.from({ length: valueCols }, (_, i) => (
              <col key={i} />
            ))}
            <col className={styles.colChange} />
          </colgroup>
          <thead>
            <tr>
              <td />
              {done.map((a) => (
                <th key={a.id} scope="col" className={styles.colHead} data-testid={`compare-col-${a.slot}`}>
                  <span className={styles.compareColumn}>
                    <span className={styles.slotName}>{SLOT_LABELS[a.slot]}</span>
                    <span className={styles.slotMeta}>{day(a.assessedOn)}</span>
                  </span>
                </th>
              ))}
              {retest2 ? (
                <th scope="col" className={styles.colHead}>
                  <span className={styles.compareColumn} data-empty="" data-testid="compare-retest2">
                    <span className={styles.slotName}>Retest 2</span>
                    <span className={styles.slotMeta}>Not done · optional</span>
                    {retest2.canStart && !readOnly ? (
                      <Button variant="secondary" size="compact" onClick={() => setStarting(true)} aria-label="Start Retest 2" phSafe>
                        Start
                      </Button>
                    ) : null}
                  </span>
                </th>
              ) : null}
              <th scope="col" className={styles.compareChangeHead}>Change</th>
            </tr>
          </thead>
          <tbody>
            <tr className={styles.sectionRow}>
              <th colSpan={valueCols + 2} scope="colgroup" id="compare-findings-heading">
                <span className={styles.compareSectionHead}>
                  <span className={styles.kicker}>Findings</span>
                  {findingCounts}
                </span>
              </th>
            </tr>
            {c.findings.length === 0 ? (
              <tr>
                <td colSpan={valueCols + 2} className={styles.caption}>{NOTHING_SEEN}</td>
              </tr>
            ) : (
              c.findings.map((f) => (
                <tr key={`${f.checkpointId}-${f.side}`}>
                  <th scope="row" data-ph-safe="">{f.label}{SIDE_TEXT[f.side]}</th>
                  {f.values.map((v, i) => (
                    <td key={i} data-value={v}>{v === 'not_tested' ? <span className={styles.changeChip} data-change="not_tested">Not tested</span> : VALUE_WORD[v]}</td>
                  ))}
                  {retest2 ? <td aria-hidden="true">–</td> : null}
                  <td><ChangeChip change={f.change} /></td>
                </tr>
              ))
            )}
          </tbody>
          {c.measures.length > 0 ? (
            <tbody>
              <tr className={styles.sectionRow}>
                <th colSpan={valueCols + 2} scope="colgroup" id="compare-measures-heading">
                  <span className={styles.compareSectionHead}>
                    <span className={styles.kicker}>Measurements</span>
                    {measureCounts}
                  </span>
                </th>
              </tr>
              {c.measures.map((m) => (
                <tr key={`${m.measureId}-${m.side}`}>
                  <th scope="row" data-ph-safe="">{m.label}{SIDE_TEXT[m.side]}</th>
                  {m.values.map((v, i) => (
                    <td key={i}>{v === null ? <span className={styles.changeChip} data-change="not_tested">Not tested</span> : formatMeasureValue(v, m.unit)}</td>
                  ))}
                  {retest2 ? <td aria-hidden="true">–</td> : null}
                  <td><MeasureDelta row={m} /></td>
                </tr>
              ))}
            </tbody>
          ) : null}
        </table>
      )}

      {slots.muscles}

      {starting && retest2?.canStart ? (
        <StartDialog
          client={client}
          slot="retest_2"
          newCycle={false}
          library={retest2.canStart.library}
          templates={retest2.canStart.templates}
          defaultKeys={retest2.canStart.initialKeys}
          onClose={() => setStarting(false)}
        />
      ) : null}
    </div>
  );
}

function ColumnPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: { value: number; label: string; disabled: boolean }[];
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className={styles.columnPicker}>
      <label htmlFor={id} className={styles.srOnly}>{label}</label>
      <select id={id} className={styles.columnSelect} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ChangeChip({ change }: { change: FindingChange | MeasureChange }) {
  return (
    // A stopped test's numbers look like "Not tested" (grey): shown, never counted.
    <span className={styles.changeChip} data-change={change === 'stopped' ? 'not_tested' : change}>
      {CHANGE_WORD[change]}
    </span>
  );
}

function MeasureDelta({ row }: { row: CompareMeasureRow }) {
  if (row.delta === null) return <ChangeChip change={row.change === 'stopped' ? 'stopped' : 'not_tested'} />;
  return (
    <span className={styles.changeChip} data-change={row.change}>
      {formatMeasureDelta(row.delta, row.unit)}
      <span className={styles.srOnly}>, {CHANGE_WORD[row.change].toLowerCase()}</span>
    </span>
  );
}

function FindingItem({ row: f }: { row: CompareFindingRow }) {
  const [a, b] = [f.values[0]!, f.values[f.values.length - 1]!];
  return (
    <li className={styles.compareItem}>
      <span className={styles.compareItemText}>
        <span className={styles.findingLabel} data-ph-safe="">{f.label}{SIDE_TEXT[f.side]}</span>
        {f.change !== 'not_tested' ? (
          <span className={styles.compareItemValues}>
            {VALUE_WORD[a]} <span aria-hidden="true">→</span><span className={styles.srOnly}> to </span> <strong>{VALUE_WORD[b]}</strong>
          </span>
        ) : null}
      </span>
      <ChangeChip change={f.change} />
    </li>
  );
}

function MeasureItem({ row: m }: { row: CompareMeasureRow }) {
  const [a, b] = [m.values[0] ?? null, m.values[m.values.length - 1] ?? null];
  const fmt = (v: number | null) => (v === null ? 'Not tested' : formatMeasureValue(v, m.unit));
  return (
    <li className={styles.compareItem}>
      <span className={styles.compareItemText}>
        <span className={styles.findingLabel} data-ph-safe="">{m.label}{SIDE_TEXT[m.side]}</span>
        <span className={styles.compareItemValues}>
          {fmt(a)} <span aria-hidden="true">→</span><span className={styles.srOnly}> to </span> <strong>{fmt(b)}</strong>
        </span>
      </span>
      <MeasureDelta row={m} />
    </li>
  );
}
