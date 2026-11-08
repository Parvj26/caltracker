'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { ProgramInput } from '@caltracker/shared';
import { Button, Card, ErrorText, TextAreaField, TextField } from '@/components/ui';
import { createProgram } from '../actions';
import styles from '../programs.module.css';
import { getTaskTracker, markCreated } from '@/lib/analytics/client';

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
/** TextField's `error` is optional, not `string | undefined` (exactOptionalPropertyTypes). */
const errorProp = (message: string | undefined) => (message ? { error: message } : {});

type FieldErrors = Partial<Record<'name' | 'description' | 'weeks', string>>;

export function NewProgramForm() {
  const router = useRouter();
  // Not abandoned when this form unmounts: the task continues on the program page until a workout is placed.
  useEffect(() => getTaskTracker().start('build_program'), []);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const description = text(form.get('description')).trim();
    const parsed = ProgramInput.safeParse({
      name: text(form.get('name')),
      description: description === '' ? null : description,
      weeks: Number(form.get('weeks')),
    });
    setFormError(null);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'name' || key === 'description' || key === 'weeks') && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    startTransition(async () => {
      try {
        const { id } = await createProgram(parsed.data);
        markCreated('program', id);
        router.push(`/programs/${id}`);
      } catch {
        setFormError("Couldn't create the program. Please try again.");
      }
    });
  }

  return (
    <Card className={styles.formCard}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <TextField label="Program name" name="name" maxLength={100} required {...errorProp(errors.name)} />
        <TextAreaField label="Description" name="description" maxLength={2000} rows={3} hint="Optional." />
        {errors.description ? <ErrorText>{errors.description}</ErrorText> : null}
        <TextField
          label="Weeks"
          name="weeks"
          type="number"
          inputMode="numeric"
          min={1}
          max={52}
          defaultValue={4}
          {...errorProp(errors.weeks)}
          className={styles.weeksField}
        />
        {formError ? <ErrorText>{formError}</ErrorText> : null}
        <div>
          <Button type="submit" pending={pending}>
            {pending ? 'Creating…' : 'Create program'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
