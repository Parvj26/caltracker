import type { Metadata } from 'next';
import { requireCoach } from '@/lib/auth';
import { listCoachMeals } from '@/lib/coach-meals';
import { MealForm } from '../meal-form';
import { MealsShell, queryFrom } from '../meals-shell';

export const metadata: Metadata = { title: 'New meal · Meals' };

export default async function NewMealPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { workspaceId } = await requireCoach();
  const [meals, sp] = await Promise.all([listCoachMeals(workspaceId), searchParams]);
  // The id is made here so the browser can name the photo files before the meal is saved.
  const id = crypto.randomUUID();
  return (
    <MealsShell meals={meals} selectedId={null} query={queryFrom(sp)} editing>
      <MealForm
        key={id}
        workspaceId={workspaceId}
        isNew
        version=""
        logged={0}
        initial={{ id, name: '', macros: { calories: null, protein: null, carbs: null, fat: null }, ingredients: '', howTo: '', photo: null }}
      />
    </MealsShell>
  );
}
