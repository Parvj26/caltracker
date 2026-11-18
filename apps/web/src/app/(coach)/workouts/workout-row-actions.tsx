'use client';

import { blockBadges, countExercises, exerciseSummaryLine, sectionRuns, type ErrorCode, type Units, type WorkoutDoc } from '@caltracker/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useDuplicate } from '@/components/duplicate-button';
import { MoreMenu } from '@/components/more-menu';
import { RowActionToast } from '@/components/row-toast';
import { AdaptiveDialog, Button, ButtonLink, ErrorText, TextField, type AdaptiveDialogHandle } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { markUndone } from '@/lib/analytics/client';
import { deleteWorkout, libraryWorkoutUses, previewWorkout, renameWorkout, type WorkoutUses } from './actions';
import styles from './workouts.module.css';
import { openLayer } from '@/lib/open-layer';

type Popup = 'preview' | 'rename' | 'delete';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Opens a <dialog> as a modal when it mounts; closing it (✕, Cancel, Escape) fires the dialog's onClose. */
function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog) openLayer(dialog);
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
 * A Workouts list row's ⋯ (Assign is the row's one visible action, beside it). iPad and desktop: a menu with Preview,
 * Duplicate, Rename and Delete…. iPhone: a sheet from the bottom with the same.
 */
export function WorkoutRowMore({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState<Popup | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const duplicate = useDuplicate('workout', id);
  const label = `More actions for ${name}`;

  return (
    <span className={styles.rowMore}>
      <MoreMenu
        label={label}
        className={styles.wideOnly}
        busy={duplicate.pending}
        items={[
          { label: 'Preview', onSelect: () => setOpen('preview') },
          { label: duplicate.pending ? 'Duplicating…' : 'Duplicate', onSelect: duplicate.run, disabled: duplicate.pending },
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
      <RowActionToast pending={duplicate.pending} error={duplicate.error} pendingText="Duplicating…" />

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
    </span>
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
      {/* Delete is a danger menu item: red text on a normal row, apart from the rest (rulebook §4, §10.1). */}
      <button type="button" className={cx(styles.sheetItem, styles.sheetDanger)} onClick={() => pick('delete')}>
        Delete…
      </button>
      <button type="button" className={cx(styles.sheetItem, styles.sheetCancel)} onClick={() => ref.current?.close()}>
        Cancel
      </button>
    </dialog>
  );
}

/**
 * The Preview's exercises, as the builder groups them: under their section headings, one row per exercise with the
 * builder's own badge (blockBadges: 1, A1, A2, 3…). A superset's exercises sit together under a "Superset" label; a
 * pick-one group is one row naming its options.
 */
function PreviewBlocks({ doc, units }: { doc: WorkoutDoc; units: Units }) {
  const badges = blockBadges(doc.blocks);
  return (
    <div className={styles.previewBody} role="group" aria-label="Exercises">
      {sectionRuns(doc.blocks, doc.sections).map((run) => (
        <div key={run.blockIndexes[0]} className={styles.previewRun} role={run.section ? 'group' : undefined} aria-label={run.section?.name}>
          {run.section ? <h3 className={styles.previewSection}>{run.section.name}</h3> : null}
          <ol className={styles.summaryList}>
            {run.blockIndexes.map((bi) => {
              const block = doc.blocks[bi]!;
              const [first] = block.exercises;
              if (block.kind === 'superset') {
                return (
                  <li key={block.id} className={cx(styles.summaryRow, styles.supersetRow)}>
                    <span className={styles.supersetLabel}>Superset</span>
                    <ol className={styles.summaryList}>
                      {block.exercises.map((e, i) => (
                        <li key={e.id} className={styles.supersetPart}>
                          <span className={styles.summaryNumber} data-superset="" aria-hidden="true">
                            {badges[bi]![i]}
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
                    {badges[bi]![0]}
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
    <AdaptiveDialog
      historyId={`preview-${id}`}
      title={loaded?.doc.name ?? name}
      subtitle={loaded ? count(total, 'exercise', 'exercises') : null}
      onClose={onClose}
      noKeyboardOnTouch
      // One way out (×, Esc, swipe down); the footer holds only the main action, full width (rulebook §5.2).
      footer={
        <ButtonLink href={`/workouts/${id}`} className={styles.previewEdit}>
          Edit workout
        </ButtonLink>
      }
    >
      {failed ? <ErrorText code="workout_load_failed" /> : null}
      {!loaded && !failed ? <p className={styles.caption}>Loading…</p> : null}
      {loaded?.doc.notes ? <p className={styles.notesBox}>{loaded.doc.notes}</p> : null}
      {loaded ? <PreviewBlocks doc={loaded.doc} units={loaded.units} /> : null}
    </AdaptiveDialog>
  );
}

/** A name field, saved through the builder's save (everything else stays as last saved). */
function RenameDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const ref = useRef<AdaptiveDialogHandle>(null);
  const formId = useId();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = value.trim() !== name.trim();

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    if (!changed) {
      void ref.current?.close();
      return;
    }
    startTransition(async () => {
      try {
        const outcome = await renameWorkout(id, value);
        if (outcome.ok) await ref.current?.close();
        else if ('issues' in outcome && outcome.issues?.[0]) setFieldError(outcome.issues[0].message);
        else setError(outcome.code);
      } catch {
        setError('workout_rename_failed');
      }
    });
  }

  return (
    <AdaptiveDialog
      ref={ref}
      historyId={`rename-${id}`}
      title="Rename workout"
      titleSafe
      onClose={onClose}
      dirty={changed}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => ref.current?.requestClose()} disabled={pending} phSafe>
            Cancel
          </Button>
          <Button type="submit" form={formId} pending={pending} phSafe>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.dialogForm} onSubmit={save}>
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
      </form>
    </AdaptiveDialog>
  );
}

function usesText(uses: WorkoutUses): string {
  const one = uses.programList.length === 1 ? uses.programList[0] : undefined;
  const programs = one ? `Used in “${one.name}”` : `Used in ${count(uses.programs, 'program', 'programs')}`;
  const invites = `in the starting plan of ${count(uses.invitePlans, "invited client who hasn't", "invited clients who haven't")} joined yet`;
  if (uses.programs > 0 && uses.invitePlans > 0) return `${programs} and ${invites} — remove it from those first.`;
  if (uses.programs > 0) return `${programs} — remove it from ${uses.programs === 1 ? 'that program' : 'them'} first.`;
  return `It's ${invites} — change ${uses.invitePlans === 1 ? 'that plan' : 'those plans'} first.`;
}

/**
 * Delete…: asks first. A workout still used in a program or an open invite's starting plan can't be deleted (that
 * would empty those days); the window says where it is used instead. Used by the Workouts list and the workout page.
 */
export function DeleteDialog({
  id,
  name,
  onClose,
  onDeleted,
  confirmLeave,
}: {
  id: string;
  name: string;
  onClose: () => void;
  onDeleted?: () => void;
  /** Before "Open “<program>”" leaves the page: asks first when the page has unsaved changes (the workout page). */
  confirmLeave?: () => Promise<boolean>;
}) {
  const ref = useRef<AdaptiveDialogHandle>(null);
  const router = useRouter();
  const bodyId = useId();
  const [uses, setUses] = useState<WorkoutUses | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  // Bumped by Try again after the usage check failed.
  const [attempt, setAttempt] = useState(0);
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
  }, [id, attempt]);
  const inUse = uses !== null && (uses.programs > 0 || uses.invitePlans > 0);
  const checkFailed = uses === null && error === 'workout_uses_failed';

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await deleteWorkout(id);
        if (outcome.ok) {
          markUndone('workout', id);
          // Off the history first, so the page's own navigation (back to the list) isn't undone by it.
          await ref.current?.close();
          onDeleted?.();
        } else setError(outcome.code);
      } catch {
        setError('workout_delete_failed');
      }
    });
  }

  return (
    <AdaptiveDialog
      ref={ref}
      historyId={`delete-${id}`}
      role="alertdialog"
      describedBy={bodyId}
      title={inUse ? `“${name}” is still in use` : `Delete “${name}”?`}
      onClose={onClose}
      busy={pending}
      stackFooterOnPhone
      footer={
        inUse ? (
          <Button onClick={() => void ref.current?.close()} phSafe>
            OK
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => ref.current?.requestClose()} disabled={pending} phSafe>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={confirm}
              pending={pending}
              disabled={uses === null}
              disabledReason={checkFailed ? "Couldn't check where it is used. Try again first." : uses === null ? 'Checking where it is used…' : undefined}
              phSafe
            >
              {pending ? 'Deleting…' : 'Delete workout'}
            </Button>
          </>
        )
      }
    >
      <p id={bodyId} className={styles.dialogBody} aria-live="polite">
        {uses === null
          ? error
            ? ''
            : 'Checking where it is used…'
          : inUse
            ? usesText(uses)
            : "It's removed from your library. Workouts already on clients' calendars and their logged history stay."}
      </p>
      {inUse && uses.programList.length > 0 ? (
        // Each program that blocks the delete, with a way to open it (rulebook §10.3). The pop-up steps off the history
        // first, so Back from the program comes back to the list, not to this question.
        <ul className={styles.blockers} aria-label="Programs that use it">
          {uses.programList.map((p) => (
            <li key={p.id}>
              <Button
                variant="secondary"
                size="compact"
                onClick={() => {
                  void (async () => {
                    await ref.current?.close();
                    // Unsaved builder edits under it: "Discard changes?" first (code navigation isn't guarded).
                    if (confirmLeave && !(await confirmLeave())) return;
                    router.push(`/programs/${p.id}`);
                  })();
                }}
              >
                Open “{p.name}”
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <ErrorText code={error} /> : null}
      {checkFailed ? (
        <Button
          variant="secondary"
          size="compact"
          className={styles.retry}
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
          phSafe
        >
          Try again
        </Button>
      ) : null}
    </AdaptiveDialog>
  );
}
