import type { Metadata } from 'next';
import { requireCoach } from '@/lib/auth';
import { listCoachMeals } from '@/lib/coach-meals';
import { MealsShell, queryFrom } from './meals-shell';
import styles from './meals.module.css';

export const metadata: Metadata = { title: 'Meals' };

export default async function MealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { workspaceId } = await requireCoach();
  const [meals, sp] = await Promise.all([listCoachMeals(workspaceId), searchParams]);
  return (
    <MealsShell meals={meals} selectedId={null} query={queryFrom(sp)} editing={false}>
      {/* With no meals the list's own "No meals yet" is the one empty state, so the hint box stays out. On a phone the
          list is the whole screen, so the hint (the laptop's empty right-hand panel) is hidden there too. */}
      {meals.length > 0 ? (
        <section className={`${styles.panel} ${styles.panelQuiet} ${styles.hintPanel}`} aria-label="Edit meal">
          <p className={styles.empty}>Pick a meal to edit it, or add a new one.</p>
        </section>
      ) : null}
    </MealsShell>
  );
}
