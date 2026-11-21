import Link from 'next/link';
import { findingChips, scoreBand, type Finding, type NotScored, type TestScore } from '@caltracker/shared';
import { Card } from '@/components/ui';
import styles from './assessments.module.css';

/** The eye before a "what to watch" line. */
export function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** A plain stand-in picture for a test (no photos yet). */
export function TestIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * The "Observed" list: each finding with its severity chips (Severe in ink, Slight in grey, each with its words).
 * `limit` shows the first few, then "+N more" linking to the whole report.
 */
export function FindingsList({ findings, limit, moreHref }: { findings: Finding[]; limit?: number; moreHref?: string }) {
  if (findings.length === 0) return <p className={styles.caption}>Nothing seen: every checkpoint was Normal.</p>;
  const shown = limit ? findings.slice(0, limit) : findings;
  const more = findings.length - shown.length;
  return (
    <>
      <ul className={styles.findings} aria-label="Observed">
        {shown.map((f) => (
          <li key={`${f.testKey}-${f.checkpointId}`} className={styles.finding}>
            <span className={styles.findingLabel} data-ph-safe="">{f.label}</span>
            <span className={styles.findingChips}>
              {findingChips(f).map((c) => (
                <span key={c.text} className={styles.sevChip} data-severity={c.severity} data-ph-safe="">{c.text}</span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {more > 0 && moreHref ? (
        <Link href={moreHref} className={styles.moreLink}>+{more} more</Link>
      ) : null}
    </>
  );
}

const NOT_SCORED_WHY: Record<NotScored, string> = {
  skipped: 'not tested',
  stopped: 'stopped',
  not_done: 'not tested',
  record_only: 'record only',
  measured: 'measured',
};

/** The Movement score card (AS6): the big number and its band, one bar per scored test, and what didn't count. */
export function ScoreCard({ score, tests, names }: { score: number | null; tests: TestScore[]; names: Record<string, string> }) {
  const scored = tests.filter((t) => t.score !== null);
  const left = tests.filter((t) => t.score === null && t.notScored !== null);
  return (
    <Card className={styles.card} aria-labelledby="score-heading" data-testid="score-card">
      <div className={styles.scoreHead}>
        <h2 id="score-heading" className={styles.heading}>Movement score</h2>
        <p className={styles.caption}>out of 100</p>
      </div>
      {score === null ? (
        <p className={styles.caption}>No score: no test with checkpoints was done.</p>
      ) : (
        <p className={styles.scoreLine}>
          <span className={styles.scoreNumber} data-testid="movement-score">{score}</span>
          <span className={styles.band} data-band={scoreBand(score).id} data-ph-safe="">{scoreBand(score).label}</span>
        </p>
      )}
      {scored.length > 0 ? (
        <ul className={styles.bars} aria-label="Score per test">
          {scored.map((t) => (
            <li key={t.key} className={styles.bar}>
              <span className={styles.barName} data-ph-safe="">{names[t.key] ?? t.key}</span>
              <span className={styles.barTrack} aria-hidden="true">
                <span className={styles.barFill} style={{ width: `${t.score}%` }} />
              </span>
              <span className={styles.barValue}>{t.score}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {left.length > 0 ? (
        <p className={styles.caption} data-ph-safe="">
          Not scored: {left.map((t) => `${names[t.key] ?? t.key} (${t.notScored ? NOT_SCORED_WHY[t.notScored] : ''})`).join(', ')}.
        </p>
      ) : null}
    </Card>
  );
}
