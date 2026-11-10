import type { ViewAsSnapshot } from '@/lib/admin-data';
import styles from './view-as.module.css';

const STATUS: Record<string, string> = { planned: 'Planned', in_progress: 'In progress', done: 'Done' };

export function TodayScreen({ s }: { s: ViewAsSnapshot }) {
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${s.today.date}T00:00:00Z`));
  return (
    <>
      <h3 className={styles.screenTitle}>Today</h3>
      <span className={styles.note}>{day}</span>
      <div className={styles.card}>
        <p className={styles.cardTitle}>TODAY&apos;S WORKOUT</p>
        {s.today.workouts.length === 0 ? (
          <p className={styles.empty}>Nothing planned today.</p>
        ) : (
          <ul className={styles.list}>
            {s.today.workouts.map((w) => (
              <li key={w.id} className={styles.item}><span>{w.name}</span><span className={styles.note}>{STATUS[w.status] ?? w.status}</span></li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.card}>
        <p className={styles.cardTitle}>THIS WEEK</p>
        <span className={styles.big}>{s.week.done} / {s.week.planned}</span>
        <span className={styles.note}>workouts done</span>
      </div>
    </>
  );
}
