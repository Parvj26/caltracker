import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/ui';
import type { ListedCoachMeal } from '@/lib/coach-meals';
import { MealList } from './meal-list';
import styles from './meals.module.css';

type SearchParams = Record<string, string | string[] | undefined>;
/** The meals search text from the address (?q=), trimmed to a sane length. */
export function queryFrom(sp: SearchParams): string {
  const v = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  return (v ?? '').slice(0, 100);
}

/**
 * The Meals page frame: title, + New meal, the searchable list of shared meals, and the panel beside it (a form or a
 * hint). From 768 px up the list and the panel sit side by side. On a phone the list is its own screen and a meal
 * (or New meal) opens full screen (`editing`): the list and the title are hidden and the form brings its own top bar.
 */
export function MealsShell({
  meals,
  selectedId,
  query,
  editing,
  children,
}: {
  meals: ListedCoachMeal[];
  selectedId: string | null;
  query: string;
  editing: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.page} data-editing={editing || undefined}>
      <header className={styles.titleRow}>
        <div className={styles.titleText}>
          <h1 className={styles.title}>Meals</h1>
          <p className={styles.subtitle}>Shared with all your clients. They can log any of these in one tap.</p>
        </div>
        <ButtonLink href="/meals/new" className={styles.newButton}>
          + New meal
        </ButtonLink>
      </header>
      <div className={styles.columns}>
        <MealList meals={meals} selectedId={selectedId} initialQuery={query} />
        {children}
      </div>
    </div>
  );
}
