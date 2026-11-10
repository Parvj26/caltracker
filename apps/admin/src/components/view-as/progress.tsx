import { formatWeight, type Units } from '@caltracker/shared';
import type { ViewAsSnapshot } from '@/lib/admin-data';
import styles from './view-as.module.css';

export function ProgressScreen({ s, units }: { s: ViewAsSnapshot; units: Units }) {
  return (
    <>
      <h3 className={styles.screenTitle}>Progress</h3>
      <div className={styles.card}>
        <p className={styles.cardTitle}>GOAL</p>
        {s.goal ? (
          <>
            <span className={styles.big}>{s.goal.text}</span>
            {s.goal.target_date ? <span className={styles.note}>by {s.goal.target_date}</span> : null}
          </>
        ) : (
          <p className={styles.empty}>No goal set.</p>
        )}
      </div>
      <div className={styles.card}>
        <p className={styles.cardTitle}>BESTS</p>
        {s.bests.length === 0 ? (
          <p className={styles.empty}>No bests yet.</p>
        ) : (
          <ul className={styles.list}>
            {s.bests.map((b, i) => (
              <li key={`${b.exercise}-${i}`} className={styles.item}>
                <span>{b.exercise}</span>
                <span className={styles.note}>{b.weight !== null ? formatWeight(b.weight, units) : '—'}{b.reps ? ` × ${b.reps}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
