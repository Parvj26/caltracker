import type { Metadata } from 'next';
import { requireCoach } from '@/lib/auth';
import { listCoachMeals } from '@/lib/coach-meals';
import { MealsShell } from './meals-shell';
import styles from './meals.module.css';

export const metadata: Metadata = { title: 'Meals' };

export default async function MealsPage() {
  const { workspaceId } = await requireCoach();
  const meals = await listCoachMeals(workspaceId);
  return (
    <MealsShell meals={meals} selectedId={null}>
      <section className={`${styles.panel} ${styles.panelQuiet}`} aria-label="Edit meal">
        <p className={styles.empty}>{meals.length > 0 ? 'Pick a meal to edit it, or add a new one.' : 'Your meals show here once you add them.'}</p>
      </section>
    </MealsShell>
  );
}
