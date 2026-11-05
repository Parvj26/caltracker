import { Card } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { ExerciseForm } from '../exercise-form';
import styles from '../exercises.module.css';

export default async function NewExercisePage() {
  await requireCoach();
  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>New custom exercise</h1>
      </header>
      <Card className={styles.formCard}>
        <ExerciseForm />
      </Card>
    </div>
  );
}
