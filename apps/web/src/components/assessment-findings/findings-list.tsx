import { ALSO_CHECKS, type AlsoCheckId } from '@caltracker/shared';
import type { FindingRow } from '@/lib/assessment-findings';
import { MarkChip, muscleSidesLabel } from './findings-map';
import styles from './findings.module.css';

const SECTION: Record<FindingRow['status'], string> = {
  over: 'Possibly overactive',
  under: 'Possibly underactive',
  normal: 'Checked · normal',
};

/**
 * The coach-confirmed findings as a list (report, summary): over, under, then checked-normal, each muscle with its
 * sides and the findings it came from. Worded as possible contributors, never a diagnosis.
 */
export function ConfirmedFindingsList({ rows, checks = [] }: { rows: readonly FindingRow[]; checks?: readonly AlsoCheckId[] }) {
  if (rows.length === 0 && checks.length === 0) return <p className={styles.caption}>No muscles confirmed yet.</p>;
  return (
    <div className={styles.confirmed} data-testid="confirmed-findings">
      {(['over', 'under', 'normal'] as const).map((status) => {
        const list = rows.filter((r) => r.status === status);
        if (list.length === 0) return null;
        return (
          <section key={status} aria-label={SECTION[status]}>
            <h3 className={styles.kicker}>{SECTION[status]}</h3>
            <ul className={styles.rows}>
              {list.map((r) => (
                <li key={`${r.muscleId}-${r.status}`} className={styles.row}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowName} data-ph-safe="">{muscleSidesLabel(r.muscleId, r.sides)}</span>
                    <MarkChip status={r.status} />
                  </span>
                  {r.from.length > 0 ? <span className={styles.caption} data-ph-safe="">from {r.from.join(', ')}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {checks.length > 0 ? (
        <section aria-label="Also check">
          <h3 className={styles.kicker}>Also check</h3>
          <ul className={styles.rows}>
            {checks.map((c) => (
              <li key={c} className={styles.row}>
                <span className={styles.rowName} data-ph-safe="">{ALSO_CHECKS[c]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
