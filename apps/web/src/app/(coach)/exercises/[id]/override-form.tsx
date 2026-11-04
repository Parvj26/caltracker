'use client';

import { useState, useTransition } from 'react';
import { saveOverride } from '../actions';
import { formText } from '../form-text';
import styles from '../exercises.module.css';

export function OverrideForm({
  exerciseId,
  youtubeUrl,
  coachNotes,
}: {
  exerciseId: string;
  youtubeUrl: string | null;
  coachNotes: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const url = formText(form, 'youtubeUrl').trim();
    const notes = formText(form, 'coachNotes').trim();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveOverride(exerciseId, { youtubeUrl: url || null, coachNotes: notes || null });
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label>
        Pinned YouTube video
        <input name="youtubeUrl" defaultValue={youtubeUrl ?? ''} placeholder="https://youtu.be/..." />
      </label>
      <label>
        Coaching notes
        <textarea name="coachNotes" rows={4} defaultValue={coachNotes ?? ''} />
      </label>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {saved ? <p role="status">Saved</p> : null}
      <button type="submit" disabled={pending}>
        Save
      </button>
    </form>
  );
}
