'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CustomExerciseInput, LIBRARY_TRACKING_TYPES } from '@caltracker/shared';
import { Button, errorFromText, ErrorText, notAContact, SelectField, TextAreaField, TextField, type FieldError } from '@/components/ui';
import { invalidateExerciseIndex } from '@/lib/exercise-index';
import { createCustomExercise, updateCustomExercise } from './actions';
import { EQUIPMENT, TRACKING_LABELS } from './filters';
import { formText } from './form-text';
import styles from './exercises.module.css';

/** The exercise name field; the form reads it back by this name. */
const EXERCISE_TITLE = notAContact('exercise-title');

export type ExerciseFormInitial = {
  name: string;
  trackingType: (typeof LIBRARY_TRACKING_TYPES)[number];
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
  const [error, setError] = useState<FieldError | null>(null);
  const [saved, setSaved] = useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => formText(form, key);
    const parsed = CustomExerciseInput.safeParse({
      name: text(EXERCISE_TITLE.name),
      trackingType: text('trackingType'),
      primaryMuscles: text('primaryMuscles').split(',').map((s) => s.trim()).filter(Boolean),
      equipment: text('equipment'),
      instructions: text('instructions').split('\n').map((s) => s.trim()).filter(Boolean),
      youtubeUrl: text('youtubeUrl'),
    });
    if (!parsed.success) {
      setError(errorFromText(parsed.error.issues[0]?.message ?? 'Check the exercise details.', 'field_format'));
      return;
    }
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        if (exerciseId) {
          await updateCustomExercise(exerciseId, parsed.data);
          invalidateExerciseIndex();
          setSaved(true);
        } else {
          const { id } = await createCustomExercise(parsed.data);
          invalidateExerciseIndex();
          router.push(`/exercises/${id}`);
        }
      } catch {
        setError({ code: 'exercise_save_failed' });
      }
    });
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      {/* An exercise's name, not a person's: its field is called "title" so iPhone Safari doesn't offer a contact. */}
      <TextField label="Name" {...EXERCISE_TITLE} autoCorrect="off" spellCheck={false} defaultValue={initial.name} maxLength={100} />
      <SelectField label="Tracking type" name="trackingType" defaultValue={initial.trackingType}>
        {LIBRARY_TRACKING_TYPES.map((t) => (
          <option key={t} value={t}>
            {TRACKING_LABELS[t]}
          </option>
        ))}
      </SelectField>
      <TextField label="Primary muscles (comma separated)" name="primaryMuscles" defaultValue={initial.primaryMuscles.join(', ')} />
      <TextField label="Equipment" name="equipment" list="equipment-options" defaultValue={initial.equipment ?? ''} />
      <datalist id="equipment-options">
        {EQUIPMENT.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
      <TextAreaField label="Instructions (one step per line)" name="instructions" rows={5} defaultValue={initial.instructions.join('\n')} />
      <TextField label="YouTube URL (optional)" name="youtubeUrl" defaultValue={initial.youtubeUrl ?? ''} />
      {error ? <ErrorText code={error.code}>{error.text}</ErrorText> : null}
      {saved ? <p role="status" className={styles.saved}>Saved</p> : null}
      <Button type="submit" pending={pending} className={styles.submit}>
        {exerciseId ? 'Save changes' : 'Create exercise'}
      </Button>
    </form>
  );
}
