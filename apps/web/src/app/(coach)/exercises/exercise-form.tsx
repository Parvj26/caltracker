'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CustomExerciseInput, TRACKING_TYPES } from '@caltracker/shared';
import { createCustomExercise, updateCustomExercise } from './actions';
import { EQUIPMENT, TRACKING_LABELS } from './filters';
import { formText } from './form-text';
import styles from './exercises.module.css';

export type ExerciseFormInitial = {
  name: string;
  trackingType: (typeof TRACKING_TYPES)[number];
  primaryMuscles: string[];
  equipment: string | null;
  instructions: string[];
  youtubeUrl: string | null;
};

const EMPTY: ExerciseFormInitial = {
  name: '',
  trackingType: 'weight_reps',
  primaryMuscles: [],
  equipment: null,
  instructions: [],
  youtubeUrl: null,
};

export function ExerciseForm({ exerciseId, initial = EMPTY }: { exerciseId?: string; initial?: ExerciseFormInitial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => formText(form, key);
    const parsed = CustomExerciseInput.safeParse({
      name: text('name'),
      trackingType: text('trackingType'),
      primaryMuscles: text('primaryMuscles').split(',').map((s) => s.trim()).filter(Boolean),
      equipment: text('equipment'),
      instructions: text('instructions').split('\n').map((s) => s.trim()).filter(Boolean),
      youtubeUrl: text('youtubeUrl'),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the exercise details.');
      return;
    }
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        if (exerciseId) {
          await updateCustomExercise(exerciseId, parsed.data);
          setSaved(true);
        } else {
          const { id } = await createCustomExercise(parsed.data);
          router.push(`/exercises/${id}`);
        }
      } catch {
        setError("Couldn't save the exercise. Please try again.");
      }
    });
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label>
        Name
        <input name="name" defaultValue={initial.name} maxLength={100} />
      </label>
      <label>
        Tracking type
        <select name="trackingType" defaultValue={initial.trackingType}>
          {TRACKING_TYPES.map((t) => (
            <option key={t} value={t}>
              {TRACKING_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Primary muscles (comma separated)
        <input name="primaryMuscles" defaultValue={initial.primaryMuscles.join(', ')} />
      </label>
      <label>
        Equipment
        <input name="equipment" list="equipment-options" defaultValue={initial.equipment ?? ''} />
        <datalist id="equipment-options">
          {EQUIPMENT.map((e) => (
            <option key={e} value={e} />
          ))}
        </datalist>
      </label>
      <label>
        Instructions (one step per line)
        <textarea name="instructions" rows={5} defaultValue={initial.instructions.join('\n')} />
      </label>
      <label>
        YouTube URL (optional)
        <input name="youtubeUrl" defaultValue={initial.youtubeUrl ?? ''} />
      </label>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {saved ? <p role="status">Saved</p> : null}
      <button type="submit" disabled={pending}>
        {exerciseId ? 'Save changes' : 'Create exercise'}
      </button>
    </form>
  );
}
