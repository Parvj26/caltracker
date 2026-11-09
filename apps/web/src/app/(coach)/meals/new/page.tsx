import type { Metadata } from 'next';
import { requireCoach } from '@/lib/auth';
import { listCoachMeals } from '@/lib/coach-meals';
import { MealForm } from '../meal-form';
import { MealsShell } from '../meals-shell';

export const metadata: Metadata = { title: 'New meal · Meals' };

export default async function NewMealPage() {
  const { workspaceId } = await requireCoach();
  const meals = await listCoachMeals(workspaceId);
  // The id is made here so the browser can name the photo files before the meal is saved.
  const id = crypto.randomUUID();
  return (
    <MealsShell meals={meals} selectedId={null}>
      <MealForm
        key={id}
        workspaceId={workspaceId}
        isNew
        initial={{ id, name: '', macros: { calories: null, protein: null, carbs: null, fat: null }, ingredients: '', howTo: '', photo: null }}
      />
    </MealsShell>
  );
}
