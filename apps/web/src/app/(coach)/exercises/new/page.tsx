import { requireCoach } from '@/lib/auth';
import { ExerciseForm } from '../exercise-form';

export default async function NewExercisePage() {
  await requireCoach();
  return (
    <div>
      <h1>New custom exercise</h1>
      <ExerciseForm />
    </div>
  );
}
