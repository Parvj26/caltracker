import { formatDuration, formatTotalWeight, type Units } from '@caltracker/shared';
import type { ViewAsSnapshot } from '@/lib/admin-data';
import styles from './view-as.module.css';

export function WorkoutsScreen({ s, units }: { s: ViewAsSnapshot; units: Units }) {
  return (
    <>
      <h3 className={styles.screenTitle}>Workouts</h3>
      <div className={styles.card}>
        <p className={styles.cardTitle}>RECENT</p>
        {s.recent_logs.length === 0 ? (
          <p className={styles.empty}>No workouts logged yet.</p>
        ) : (
          <ul className={styles.list}>
            {s.recent_logs.map((l) => (
              <li key={l.id} className={styles.item}>
                <span>
                  {l.title}
                  <span className={styles.note}> · {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(l.finished_at))}</span>
                </span>
                <span className={styles.note}>
                  {[l.duration_s ? formatDuration(l.duration_s) : null, l.volume !== null ? formatTotalWeight(l.volume, units) : null].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
