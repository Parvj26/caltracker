'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { PROGRAM_WEEKS_MAX, ProgramInput } from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { SaveStatus } from '@/components/save-status';
import { Button, Card, ErrorText, TextAreaField, TextField } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { countSlotsBeyondWeek, updateProgram } from '../actions';
import type { Program } from './program-grid';
import { shrinkWarning } from './shrink-warning';
import styles from '../programs.module.css';

/** TextField's `error` is optional, not `string | undefined` (exactOptionalPropertyTypes). */
const errorProp = (message: string | undefined) => (message ? { error: message } : {});

/** The program's name, length and description, with "Save details" (shrinking asks first). */
export function ProgramDetails({
  program,
  weeks,
  onSaved,
}: {
  program: Program;
  /** The saved length; the field follows it when "+ Add week" changes it. */
  weeks: number;
  onSaved: (details: { name: string; description: string | null }, weeks: number, removed: number, expected: number) => void;
}) {
  const [name, setName] = useState(program.name);
  const [description, setDescription] = useState(program.description ?? '');
  const [weeksText, setWeeksText] = useState(String(program.weeks));
  const [errors, setErrors] = useState<Partial<Record<'name' | 'description' | 'weeks', string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<{ input: ProgramInput; count: number } | null>(null);
  const [saved, setSaved] = useState({ name: program.name, description: program.description ?? '' });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const [shownWeeks, setShownWeeks] = useState(weeks);
  if (shownWeeks !== weeks) {
    setShownWeeks(weeks);
    setWeeksText(String(weeks));
  }
  useEffect(() => {
    if (confirm && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [confirm]);
  const dirty = name !== saved.name || description !== saved.description || weeksText !== String(weeks);

  async function save(input: ProgramInput, expected: number) {
    setPending(true);
    setFormError(null);
    try {
      const outcome = await updateProgram(program.id, input);
      if (!outcome.ok) {
        setFormError(outcome.error);
        return;
      }
      setSaved({ name, description });
      setSavedAt(Date.now());
      onSaved({ name: input.name, description: input.description }, input.weeks, outcome.removedSlots, expected);
    } catch (e) {
      setFormError(failureMessage(e, "Couldn't save. Please try again."));
    } finally {
      setPending(false);
      dialogRef.current?.close();
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = ProgramInput.safeParse({
      name,
      description: description.trim() === '' ? null : description,
      weeks: weeksText.trim() === '' ? Number.NaN : Number(weeksText),
    });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'name' || key === 'description' || key === 'weeks') && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    // Shrinking removes the workouts in the cut weeks: say how many first (Review Focus 5).
    if (parsed.data.weeks < weeks) {
      setPending(true);
      let count: number;
      try {
        count = await countSlotsBeyondWeek(program.id, parsed.data.weeks);
      } catch (e) {
        setPending(false);
        setFormError(failureMessage(e, "Couldn't check the weeks you're removing. Please try again."));
        return;
      }
      setPending(false);
      if (count > 0) {
        setConfirm({ input: parsed.data, count });
        return;
      }
    }
    await save(parsed.data, 0);
  }

  return (
    <Card className={styles.formCard}>
      <form className={styles.detailsForm} onSubmit={(e) => void submit(e)} noValidate>
        <TextField
          label="Program name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          {...errorProp(errors.name)}
          className={styles.nameField}
        />
        <TextField
          label="Weeks"
          type="number"
          inputMode="numeric"
          min={1}
          max={PROGRAM_WEEKS_MAX}
          value={weeksText}
          onChange={(e) => setWeeksText(e.target.value)}
          {...errorProp(errors.weeks)}
          className={styles.weeksField}
        />
        <TextAreaField
          label="Description"
          value={description}
          maxLength={2000}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          className={styles.descriptionField}
        />
        {errors.description ? <ErrorText>{errors.description}</ErrorText> : null}
        <div className={cx(styles.fullRow, styles.detailsSave)}>
          <Button type="submit" variant="secondary" pending={pending && !confirm}>
            {pending && !confirm ? 'Saving…' : 'Save details'}
          </Button>
          {/* The page's own status line says "All changes saved", so this one only flags edits and shows the tick. */}
          <SaveStatus pending={pending && !confirm} dirty={dirty} everSaved={false} savedAt={savedAt} />
          {formError ? <ErrorText>{formError}</ErrorText> : null}
          {formError === STALE_DEPLOY_MESSAGE ? <ReloadButton className={styles.smallButton} /> : null}
        </div>
      </form>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
        onClose={() => setConfirm(null)}
      >
        <h2 id={titleId} className={styles.dialogTitle}>Remove workouts?</h2>
        <p id={bodyId} className={styles.dialogBody}>
          {confirm ? shrinkWarning(weeks, confirm.input.weeks, confirm.count) : null}
        </p>
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => {
              if (confirm) void save(confirm.input, confirm.count);
            }} pending={pending}>
            {pending ? 'Saving…' : 'Remove and save'}
          </Button>
        </div>
      </dialog>
    </Card>
  );
}
