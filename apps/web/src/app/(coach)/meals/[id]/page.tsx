import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { listCoachMeals } from '@/lib/coach-meals';
import { MealForm } from '../meal-form';
import { MealsShell } from '../meals-shell';

export const metadata: Metadata = { title: 'Edit meal · Meals' };

export default async function EditMealPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId } = await requireCoach();
  const { id } = await params;
  const meals = await listCoachMeals(workspaceId);
  const meal = meals.find((m) => m.id === id);
  if (!meal) notFound();
  return (
    <MealsShell meals={meals} selectedId={meal.id}>
      <MealForm
        key={`${meal.id}:${meal.updatedAt}`}
        workspaceId={workspaceId}
        isNew={false}
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
