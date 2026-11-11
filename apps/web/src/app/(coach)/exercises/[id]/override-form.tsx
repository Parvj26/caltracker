'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useState, useTransition } from 'react';
import { Button, ErrorText, TextAreaField, TextField } from '@/components/ui';
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
  const [error, setError] = useState<ErrorCode | null>(null);
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
      else setError(result.code);
    });
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <TextField label="Pinned YouTube video" name="youtubeUrl" defaultValue={youtubeUrl ?? ''} placeholder="https://youtu.be/..." />
      <TextAreaField label="Coaching notes" name="coachNotes" rows={4} defaultValue={coachNotes ?? ''} />
      {error ? <ErrorText code={error} /> : null}
      {saved ? <p role="status" className={styles.saved}>Saved</p> : null}
      <Button type="submit" pending={pending} className={styles.submit}>Save</Button>
    </form>
  );
}
