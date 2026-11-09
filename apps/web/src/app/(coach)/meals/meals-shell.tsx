import Link from 'next/link';
import type { ReactNode } from 'react';
import { compactMacroLine } from '@caltracker/shared';
import { ButtonLink } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import type { ListedCoachMeal } from '@/lib/coach-meals';
import styles from './meals.module.css';

const TILES = ['var(--ct-drop)', 'var(--ct-lime)', 'var(--ct-blue)', 'var(--ct-celebrate-bg)'];
/** The colour tile for a meal without a photo, fixed by its id. */
export function tileColour(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TILES[h % TILES.length] ?? 'var(--ct-surface)';
}

/** The Meals page frame: title, + New meal, the list of shared meals, and the panel beside it (a form or a hint). */
export function MealsShell({ meals, selectedId, children }: { meals: ListedCoachMeal[]; selectedId: string | null; children: ReactNode }) {
  return (
    <div className={styles.page}>
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
        {meals.length === 0 ? (
          <p className={styles.empty} data-testid="coach-meals-empty">
            No meals yet. Add one your clients can log in one tap.
          </p>
        ) : (
          <ul className={styles.list} aria-label="Shared meals">
            {meals.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/meals/${m.id}`}
                  className={cx(styles.row, m.id === selectedId && styles.rowSelected)}
                  aria-current={m.id === selectedId ? 'page' : undefined}
                  data-testid="coach-meal-row"
                >
                  {m.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link; next/image can't cache it
                    <img src={m.thumbUrl} alt={`${m.name} photo`} className={styles.thumb} />
                  ) : (
                    <span className={styles.thumb} style={{ background: tileColour(m.id) }} aria-hidden="true" />
                  )}
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{m.name}</span>
                    <span className={styles.rowMacros}>{compactMacroLine(m.macros)}</span>
                  </span>
                  <span className={styles.rowLogged}>{m.logged > 0 ? `logged ${m.logged}×` : 'not yet'}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {children}
      </div>
    </div>
  );
}
