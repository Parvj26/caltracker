import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { listCoachMeals } from '@/lib/coach-meals';
import { MealForm } from '../meal-form';
import { MealsShell, queryFrom } from '../meals-shell';

export const metadata: Metadata = { title: 'Edit meal · Meals' };

export default async function EditMealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await requireCoach();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const meals = await listCoachMeals(workspaceId);
  const meal = meals.find((m) => m.id === id);
  if (!meal) notFound();
  return (
    <MealsShell meals={meals} selectedId={meal.id} query={queryFrom(sp)} editing>
      {/* Keyed by the meal only: after a save the form's fields reset to the saved meal (version), but its "Saved"
          message is kept, so it no longer flashes away when the page refreshes. */}
      <MealForm
        key={meal.id}
        version={meal.updatedAt}
        workspaceId={workspaceId}
        isNew={false}
        logged={meal.logged}
        initial={{
          id: meal.id,
          name: meal.name,
          macros: meal.macros,
          ingredients: meal.ingredients,
          howTo: meal.howTo,
          photo: meal.photo ? { ...meal.photo, url: meal.photoUrl } : null,
        }}
      />
    </MealsShell>
  );
}
