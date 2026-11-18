import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { listCoachMeals } from '@/lib/coach-meals';
import { MealDetail } from '../meal-detail';
import { MealsShell, queryFrom } from '../meals-shell';

export const metadata: Metadata = { title: 'Meal · Meals' };

/** A meal's own page: read-only, with Edit and (in ⋯) Remove. */
export default async function MealPage({
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
  const query = queryFrom(sp);
  return (
    <MealsShell meals={meals} selectedId={meal.id} query={query} open>
      <MealDetail
        meal={{
          id: meal.id,
          name: meal.name,
          macros: meal.macros,
          ingredients: meal.ingredients,
          howTo: meal.howTo,
          photoUrl: meal.photoUrl,
          thumbUrl: meal.thumbUrl,
          logged: meal.logged,
        }}
        query={query}
      />
    </MealsShell>
  );
}
