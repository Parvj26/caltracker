'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { MACRO_KEYS, formatMacro, type MacroKey, type MealMacros } from '@caltracker/shared';
import { MoreMenu } from '@/components/more-menu';
import { AdaptiveDialog, Button, ButtonLink, ErrorText, PageHeader, type AdaptiveDialogHandle } from '@/components/ui';
import type { ErrorCode } from '@caltracker/shared';
import { removeCoachMeal } from './actions';
import { loggedNote, mealEditHref, mealsListHref } from './meal-labels';
import { MealTile } from './meal-list';
import styles from './meals.module.css';

const MACRO_NAME: Record<MacroKey, string> = { calories: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
export const REMOVE_BODY = "Clients won't see it any more. Meals they already logged stay.";

export type MealDetailValue = {
  id: string;
  name: string;
  macros: MealMacros;
  ingredients: string;
  howTo: string;
  photoUrl: string | null;
  thumbUrl: string | null;
  logged: number;
};

/**
 * A meal's own page, read-only (UX review C: opening a meal no longer drops you into a form, so macros aren't changed
 * by accident). Edit is the main action; Remove is in ⋯ and asks first. Empty fields are left out.
 */
export function MealDetail({ meal, query }: { meal: MealDetailValue; query: string }) {
  const [asking, setAsking] = useState(false);
  const logged = loggedNote(meal.logged);
  const macros = MACRO_KEYS.filter((k) => meal.macros[k] !== null);
  return (
    <section className={styles.panel} aria-labelledby="meal-title" data-testid="coach-meal-detail">
      <PageHeader
        className={styles.panelHeader}
        titleId="meal-title"
        title={meal.name}
        back={{ href: mealsListHref(query), label: 'Meals' }}
        subtitle={logged}
        action={
          <ButtonLink href={mealEditHref(meal.id, query)} size="compact" phSafe>
            Edit
          </ButtonLink>
        }
        more={<MoreMenu label="More for this meal" items={[{ label: 'Remove meal…', danger: true, onSelect: () => setAsking(true) }]} />}
      />
      {meal.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link; next/image can't cache it
        <img src={meal.photoUrl} alt={`${meal.name} photo`} className={styles.detailPhoto} />
      ) : (
        <MealTile id={meal.id} name={meal.name} src={null} className={styles.detailTile} />
      )}
      {macros.length > 0 ? (
        <dl className={styles.macroTiles}>
          {macros.map((k) => (
            <div key={k} className={styles.macroTile}>
              <dt>{MACRO_NAME[k]}</dt>
              <dd>{formatMacro(k, meal.macros[k] as number)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {meal.ingredients.trim() ? (
        <div className={styles.detailBlock}>
          <h2 className={styles.detailHeading}>Ingredients</h2>
          <p className={styles.detailText}>{meal.ingredients}</p>
        </div>
      ) : null}
      {meal.howTo.trim() ? (
        <div className={styles.detailBlock}>
          <h2 className={styles.detailHeading}>How to make it</h2>
          <p className={styles.detailText}>{meal.howTo}</p>
        </div>
      ) : null}
      {asking ? <RemoveMeal id={meal.id} name={meal.name} query={query} onClose={() => setAsking(false)} /> : null}
    </section>
  );
}

function RemoveMeal({ id, name, query, onClose }: { id: string; name: string; query: string; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<AdaptiveDialogHandle>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  async function remove() {
    setPending(true);
    setError(null);
    const out = await removeCoachMeal(id);
    setPending(false);
    if (!out.ok) {
      setError(out.code);
      return;
    }
    await ref.current?.close();
    router.push(mealsListHref(query));
    router.refresh();
  }
  return (
    <AdaptiveDialog
      ref={ref}
      historyId={`remove-meal-${id}`}
      role="alertdialog"
      title={`Remove “${name}”?`}
      describedBy="remove-meal-body"
      onClose={onClose}
      busy={pending}
      stackFooterOnPhone
      footer={
        <>
          <Button variant="secondary" onClick={() => ref.current?.requestClose()} disabled={pending} phSafe>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void remove()} pending={pending} phSafe>
            {pending ? 'Removing…' : 'Remove meal'}
          </Button>
        </>
      }
    >
      <p id="remove-meal-body">{REMOVE_BODY}</p>
      {error ? <ErrorText code={error} /> : null}
    </AdaptiveDialog>
  );
}
