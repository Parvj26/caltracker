'use client';

import { countExercises, exerciseSummaryLine, sectionRuns, type ErrorCode, type Units, type WorkoutDoc } from '@caltracker/shared';
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { AssignButton } from '@/components/assign/assign-to-clients';
import { DialogHeader } from '@/components/assign/dialog-header';
import { DuplicateButton, useDuplicate } from '@/components/duplicate-button';
import { MoreMenu } from '@/components/more-menu';
import { Button, ButtonLink, ErrorText, TextField } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import sheet from '@/components/ui/sheet.module.css';
import { markUndone } from '@/lib/analytics/client';
import { deleteWorkout, libraryWorkoutUses, previewWorkout, renameWorkout, type WorkoutUses } from './actions';
import coach from '../coach.module.css';
import styles from './workouts.module.css';
import assignStyles from '@/components/assign/assign.module.css';

type Popup = 'preview' | 'rename' | 'delete';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Opens a <dialog> as a modal when it mounts; closing it (✕, Cancel, Escape) fires the dialog's onClose. */
function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return ref;
}

const DotsIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);

/**
 * A Workouts list row's actions. iPad and desktop: Assign, Duplicate and ⋯ (Preview, Rename, Delete…). iPhone: Assign
 * and ⋯, which opens a sheet from the bottom with Preview, Duplicate, Rename and Delete….
 */
export function WorkoutRowActions({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState<Popup | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const duplicate = useDuplicate('workout', id);
  const label = `More actions for ${name}`;

  return (
    <div className={cx(assignStyles.actions, styles.rowActions)}>
      <AssignButton kind="workout" id={id} name={name} compact />
      <span className={styles.wideOnly}>
        <DuplicateButton kind="workout" id={id} name={name} compact />
      </span>
      <MoreMenu
        label={label}
        className={cx(styles.more, styles.wideOnly)}
        items={[
          { label: 'Preview', onSelect: () => setOpen('preview') },
          { label: 'Rename', onSelect: () => setOpen('rename') },
          { label: 'Delete…', onSelect: () => setOpen('delete'), danger: true },
        ]}
      />
      <button
        type="button"
        className={cx(styles.moreButton, styles.phoneOnlyFlex)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        aria-busy={duplicate.pending || undefined}
        onClick={() => setSheetOpen(true)}
      >
        {DotsIcon}
      </button>
      {duplicate.pending ? (
        <span className={coach.srClose} role="status">
          Duplicating…
        </span>
      ) : null}
      {duplicate.error ? <ErrorText code={duplicate.error} /> : null}

      {sheetOpen ? (
        <ActionSheet
          name={name}
          onDone={(next) => {
            setSheetOpen(false);
            if (next === 'duplicate') duplicate.run();
            else if (next) setOpen(next);
          }}
        />
      ) : null}
      {open === 'preview' ? <PreviewDialog id={id} name={name} onClose={() => setOpen(null)} /> : null}
      {open === 'rename' ? <RenameDialog id={id} name={name} onClose={() => setOpen(null)} /> : null}
      {open === 'delete' ? <DeleteDialog id={id} name={name} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** iPhone: the row's actions as big buttons in a sheet from the bottom. A tap outside, or Escape, closes it. */
function ActionSheet({ name, onDone }: { name: string; onDone: (next: Popup | 'duplicate' | null) => void }) {
  const picked = useRef<Popup | 'duplicate' | null>(null);
  const titleId = useId();
  const ref = useModal();
  const pick = (next: Popup | 'duplicate') => {
    picked.current = next;
    ref.current?.close();
  };
  return (
    <dialog
      ref={ref}
      className={styles.actionSheet}
      aria-labelledby={titleId}
      onClose={() => onDone(picked.current)}
      onClick={(e) => {
        // The backdrop: a tap above the sheet lands on the <dialog> itself, outside its box.
        const box = e.currentTarget.getBoundingClientRect();
        if (e.target === e.currentTarget && e.clientY < box.top) ref.current?.close();
      }}
    >
      <span className={styles.grab} aria-hidden="true" />
      <h2 id={titleId} className={styles.sheetTitle}>
        {name}
      </h2>
      <button type="button" className={styles.sheetItem} onClick={() => pick('preview')}>
        Preview
      </button>
      <button type="button" className={styles.sheetItem} onClick={() => pick('duplicate')}>
        Duplicate
      </button>
      <button type="button" className={styles.sheetItem} onClick={() => pick('rename')}>
        Rename
      </button>
      <button type="button" className={cx(styles.sheetItem, styles.sheetDanger)} onClick={() => pick('delete')}>
        Delete…
      </button>
      <button type="button" className={coach.srClose} onClick={() => ref.current?.close()}>
        Close
      </button>
    </dialog>
  );
}

const LETTERS = 'abcdefghij';

/**
 * The Preview's exercises, as the builder groups them: under their section headings, one numbered row per block. A
 * superset is one numbered row with its exercises as 2a, 2b…; a pick-one group is one row naming its options.
 */
function PreviewBlocks({ doc, units }: { doc: WorkoutDoc; units: Units }) {
  return (
    <div className={cx(styles.previewBody, sheet.grow)} role="group" aria-label="Exercises">
      {sectionRuns(doc.blocks, doc.sections).map((run) => (
        <div key={run.blockIndexes[0]} className={styles.previewRun} role={run.section ? 'group' : undefined} aria-label={run.section?.name}>
          {run.section ? <h3 className={styles.previewSection}>{run.section.name}</h3> : null}
          <ol className={styles.summaryList}>
            {run.blockIndexes.map((bi) => {
              const block = doc.blocks[bi]!;
              const n = bi + 1;
              const [first] = block.exercises;
              if (block.kind === 'superset') {
                return (
                  <li key={block.id} className={cx(styles.summaryRow, styles.supersetRow)}>
                    <span className={styles.supersetLabel}>Superset</span>
                    <ol className={styles.summaryList}>
                      {block.exercises.map((e, i) => (
                        <li key={e.id} className={styles.supersetPart}>
                          <span className={styles.summaryNumber} aria-hidden="true">
                            {`${n}${LETTERS[i] ?? ''}`}
                          </span>
                          <span className={styles.summaryText}>
                            <span className={styles.summaryName}>{e.exerciseName}</span>
                            <span className={styles.caption}>{exerciseSummaryLine(e, units)}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </li>
                );
              }
              return (
                <li key={block.id} className={styles.summaryRow}>
                  <span className={styles.summaryNumber} aria-hidden="true">
                    {n}
                  </span>
                  <span className={styles.summaryText}>
                    <span className={styles.summaryName}>
                      {block.kind === 'choice' ? `Pick one: ${block.exercises.map((e) => e.exerciseName).join(' or ')}` : first?.exerciseName}
                    </span>
                    {first ? <span className={styles.caption}>{exerciseSummaryLine(first, units)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

/** Read-only: the workout's exercises, one line each with their sets, and its notes. Edit workout opens the builder. */
function PreviewDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const ref = useModal();
  const titleId = useId();
  const [loaded, setLoaded] = useState<{ doc: WorkoutDoc; units: Units } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    previewWorkout(id)
      .then((w) => {
        if (!live) return;
        if (w) setLoaded(w);
        else setFailed(true);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [id]);
  const total = loaded ? countExercises(loaded.doc.blocks.map((b) => ({ kind: b.kind, exercises: b.exercises.length }))) : 0;

  return (
    <dialog ref={ref} className={cx(styles.dialog, styles.preview, sheet.sheet)} aria-labelledby={titleId} onClose={onClose}>
      <DialogHeader
        titleId={titleId}
        title={loaded?.doc.name ?? name}
        subtitle={loaded ? count(total, 'exercise', 'exercises') : null}
        onClose={() => ref.current?.close()}
      />
      {failed ? <ErrorText code="workout_load_failed" /> : null}
      {!loaded && !failed ? <p className={styles.caption}>Loading…</p> : null}
      {loaded?.doc.notes ? <p className={styles.notesBox}>{loaded.doc.notes}</p> : null}
      {loaded ? <PreviewBlocks doc={loaded.doc} units={loaded.units} /> : null}
      <div className={cx(styles.dialogActions, sheet.actions)}>
        <Button variant="secondary" onClick={() => ref.current?.close()}>
          Close
        </Button>
        <ButtonLink href={`/workouts/${id}`}>Edit workout</ButtonLink>
      </div>
    </dialog>
  );
}

/** A name field, saved through the builder's save (everything else stays as last saved). */
function RenameDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const ref = useModal();
  const titleId = useId();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    if (value.trim() === name.trim()) {
      ref.current?.close();
      return;
    }
    startTransition(async () => {
      try {
        const outcome = await renameWorkout(id, value);
        if (outcome.ok) ref.current?.close();
        else if ('issues' in outcome && outcome.issues?.[0]) setFieldError(outcome.issues[0].message);
        else setError(outcome.code);
      } catch {
        setError('workout_rename_failed');
      }
    });
  }

  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, sheet.sheet)}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
    >
      <DialogHeader titleId={titleId} title="Rename workout" titleSafe onClose={() => ref.current?.close()} disabled={pending} />
      <form className={cx(styles.dialogForm, sheet.body)} onSubmit={save}>
        <TextField
          label="Name"
          name="name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={100}
          required
          autoComplete="off"
          error={fieldError ? { code: 'workout_fields_invalid', text: fieldError } : undefined}
        />
        {error ? <ErrorText code={error} /> : null}
        <div className={cx(styles.dialogActions, sheet.actions)}>
          <Button variant="secondary" onClick={() => ref.current?.close()} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" pending={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function usesText(uses: WorkoutUses): string {
  const programs = `Used in ${count(uses.programs, 'program', 'programs')}`;
  const invites = `in the starting plan of ${count(uses.invitePlans, "invited client who hasn't", "invited clients who haven't")} joined yet`;
  if (uses.programs > 0 && uses.invitePlans > 0) return `${programs} and ${invites} — remove it from those first.`;
  if (uses.programs > 0) return `${programs} — remove it from ${uses.programs === 1 ? 'that program' : 'them'} first.`;
  return `It's ${invites} — change ${uses.invitePlans === 1 ? 'that plan' : 'those plans'} first.`;
}

/**
 * Delete…: asks first. A workout still used in a program or an open invite's starting plan can't be deleted (that
 * would empty those days); the window says where it is used instead. Used by the Workouts list and the workout page.
 */
export function DeleteDialog({ id, name, onClose, onDeleted }: { id: string; name: string; onClose: () => void; onDeleted?: () => void }) {
  const ref = useModal();
  const titleId = useId();
  const bodyId = useId();
  const [uses, setUses] = useState<WorkoutUses | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let live = true;
    libraryWorkoutUses(id)
      .then((u) => {
        if (live) setUses(u);
      })
      .catch(() => {
        if (live) setError('workout_uses_failed');
      });
    return () => {
      live = false;
    };
  }, [id]);
  const inUse = uses !== null && (uses.programs > 0 || uses.invitePlans > 0);

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await deleteWorkout(id);
        if (outcome.ok) {
          markUndone('workout', id);
          ref.current?.close();
          onDeleted?.();
        } else setError(outcome.code);
      } catch {
        setError('workout_delete_failed');
      }
    });
  }

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClose={onClose}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
    >
      <h2 id={titleId} className={styles.dialogTitle}>
        {inUse ? `“${name}” is still in use` : `Delete “${name}”?`}
      </h2>
      <p id={bodyId} className={styles.dialogBody} aria-live="polite">
        {uses === null
          ? error
            ? ''
            : 'Checking where it is used…'
          : inUse
            ? usesText(uses)
            : "It's removed from your library. Workouts already on clients' calendars and their logged history stay."}
      </p>
      {error ? <ErrorText code={error} /> : null}
      <div className={styles.dialogActions}>
        {inUse ? (
          <Button onClick={() => ref.current?.close()}>OK</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => ref.current?.close()} disabled={pending}>
              Cancel
            </Button>
            <Button className={styles.dangerButton} onClick={confirm} pending={pending} disabled={uses === null}>
              {pending ? 'Deleting…' : 'Delete workout'}
            </Button>
          </>
        )}
      </div>
    </dialog>
  );
}
