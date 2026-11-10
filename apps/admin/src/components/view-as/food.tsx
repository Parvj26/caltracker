import type { ViewAsSnapshot } from '@/lib/admin-data';
import styles from './view-as.module.css';

export function FoodScreen({ s }: { s: ViewAsSnapshot }) {
  const kcal = s.meals_today.reduce((sum, m) => sum + (m.kcal ?? 0), 0);
  const protein = s.meals_today.reduce((sum, m) => sum + (m.protein_g ?? 0), 0);
  return (
    <>
      <h3 className={styles.screenTitle}>Food</h3>
      <div className={styles.card}>
        <p className={styles.cardTitle}>TODAY</p>
        <span className={styles.big}>{Math.round(kcal)} kcal</span>
        <span className={styles.note}>
          {Math.round(protein)} g protein
          {s.targets ? ` · target ${s.targets.kcal ?? '—'} kcal, ${s.targets.protein_g ?? '—'} g protein` : ' · no targets set'}
        </span>
      </div>
      <div className={styles.card}>
        <p className={styles.cardTitle}>MEALS</p>
        {s.meals_today.length === 0 ? (
          <p className={styles.empty}>No meals logged today.</p>
        ) : (
          <ul className={styles.list}>
            {s.meals_today.map((m, i) => (
              <li key={`${m.name}-${i}`} className={styles.item}><span>{m.name}</span><span className={styles.note}>{m.kcal ?? '—'} kcal</span></li>
            ))}
          </ul>
        )}
      </div>
      <p className={styles.note}>{s.coach_meals === 0 ? 'No meals shared by the coach.' : `${s.coach_meals} meals shared by the coach.`}</p>
    </>
  );
}
