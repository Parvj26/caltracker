import type { Metadata } from 'next';
import { Card } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { ExerciseForm } from '../exercise-form';
import styles from '../exercises.module.css';
import { BackToExercises } from '../[id]/back-link';

export const metadata: Metadata = { title: 'New exercise · Exercises' };

export default async function NewExercisePage() {
  await requireCoach();
  return (
    <div className={styles.page}>
      {/* ‹ Exercises, like the exercise page (the list as the coach left it). */}
      <BackToExercises />
      <header className={styles.titleRow}>
        <h1 className={styles.title}>New custom exercise</h1>
      </header>
      <Card className={styles.formCard}>
        <ExerciseForm />
      </Card>
    </div>
  );
}
