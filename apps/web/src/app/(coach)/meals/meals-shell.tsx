import type { ReactNode } from 'react';
import { CreateLink, PageHeader } from '@/components/ui';
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
 * The Meals page frame: the title with "+ New meal", the searchable list of shared meals, and the panel beside it (a
 * meal, the form, or a hint). When the page is wide (iPad landscape, desktop) the list and the panel sit side by side.
 * Narrower (phone, iPad portrait) the list is its own screen, and a meal or the form fills the screen with its own
 * "‹ Meals" (`open`): the list and the title are hidden. On a meal's own pages the panel has the page's h1.
 */
export function MealsShell({
  meals,
  selectedId,
  query,
  open,
  children,
}: {
  meals: ListedCoachMeal[];
  selectedId: string | null;
  query: string;
  /** A meal or the form is open (the list's h1 steps aside for the panel's). */
  open: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.page} data-open={open || undefined}>
      <div className={styles.inner}>
        <PageHeader
          className={styles.header}
          title="Meals"
          titleAs={open ? 'p' : 'h1'}
          subtitle="Shared with all your clients. They can log any of these in one tap."
          action={<CreateLink href="/meals/new" thing="meal" />}
        />
        <div className={styles.columns}>
          <MealList meals={meals} selectedId={selectedId} initialQuery={query} />
          {children}
        </div>
      </div>
    </div>
  );
}
