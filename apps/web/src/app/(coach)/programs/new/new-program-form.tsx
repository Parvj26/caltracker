'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { ProgramInput, codeForMessage, type ErrorCode } from '@caltracker/shared';
import { Button, Card, ErrorText, TextAreaField, TextField, errorFromText } from '@/components/ui';
import { createProgram } from '../actions';
import styles from '../programs.module.css';
import { markCreated, setBuildingProgram, startBuildingProgram } from '@/lib/analytics/client';

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
/** TextField's `error` is optional, not `string | undefined` (exactOptionalPropertyTypes). */
const errorProp = (message: string | undefined, fallback: ErrorCode = 'field_format') => (message ? { error: errorFromText(message, fallback) } : {});

type FieldErrors = Partial<Record<'name' | 'description' | 'weeks', string>>;

export function NewProgramForm() {
  const router = useRouter();
  // Not abandoned when this form unmounts: the task continues on the program page until a workout is placed.
  useEffect(() => startBuildingProgram(), []);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<ErrorCode | null>(null);
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
        setBuildingProgram(id);
        router.push(`/programs/${id}`);
      } catch {
        setFormError('program_create_failed');
      }
    });
  }

  return (
    <Card className={styles.formCard}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <TextField label="Program name" name="name" maxLength={100} required {...errorProp(errors.name, 'program_name_required')} />
        <TextAreaField label="Description" name="description" maxLength={2000} rows={3} hint="Optional." />
        {errors.description ? <ErrorText code={codeForMessage(errors.description, 'field_format')}>{errors.description}</ErrorText> : null}
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
        {formError ? <ErrorText code={formError} /> : null}
        <div>
          <Button type="submit" pending={pending} data-ph-capture-attribute-label="program_name_save">
            {pending ? 'Creating…' : 'Create program'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
