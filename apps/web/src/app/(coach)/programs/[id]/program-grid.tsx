'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { PROGRAM_WEEKS_MAX, ProgramInput } from '@caltracker/shared';
import { Button, Card, ErrorText, SelectField, TextAreaField, TextField } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import {
  addProgramWorkout,
  countSlotsBeyondWeek,
  moveProgramWorkout,
  removeProgramWorkout,
  updateProgram,
} from '../actions';
import { matchesSearch } from './search';
import { shrinkWarning } from './shrink-warning';
import { WorkoutPicker } from './workout-picker';
import styles from '../programs.module.css';

export type Slot = { id: string; week: number; day: number; position: number; workoutId: string; workoutName: string };
export type LibraryWorkout = { id: string; name: string };
type Program = { id: string; name: string; description: string | null; weeks: number };

/** What is being dragged: a library workout (adds a slot) or an existing slot (moves it). */
type DragData = { kind: 'library'; workout: LibraryWorkout } | { kind: 'slot'; slot: Slot };
type DropData = { week: number; day: number };

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const cellLabel = (week: number, day: number) => `Week ${week}, Day ${day}`;
const cellId = (week: number, day: number) => `cell-${week}-${day}`;
/** DOM ids, so focus can land somewhere sensible after a chip moves or disappears. */
const addButtonDomId = (week: number, day: number) => `program-add-${week}-${day}`;
const chipDomId = (slotId: string) => `program-chip-${slotId}`;
const focusSoon = (domId: string) => requestAnimationFrame(() => document.getElementById(domId)?.focus());
/** TextField's `error` is optional, not `string | undefined` (exactOptionalPropertyTypes). */
const errorProp = (message: string | undefined) => (message ? { error: message } : {});
const SAVE_ERROR = "Couldn't save that change, so it was undone. Please try again.";

// Pointer first (exact for the mouse); the keyboard sensor has no pointer, so fall back to overlap.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

const dragName = (data: unknown) => {
  const d = data as DragData | undefined;
  return d?.kind === 'library' ? d.workout.name : d?.kind === 'slot' ? d.slot.workoutName : 'workout';
};
const dropName = (data: unknown) => {
  const d = data as DropData | undefined;
  return d ? cellLabel(d.week, d.day) : 'nowhere';
};
const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${dragName(active.data.current)}.`,
  onDragOver: ({ active, over }) =>
    over ? `${dragName(active.data.current)} is over ${dropName(over.data.current)}.` : `${dragName(active.data.current)} is not over a day.`,
  onDragEnd: ({ active, over }) =>
    over ? `Dropped ${dragName(active.data.current)} on ${dropName(over.data.current)}.` : `${dragName(active.data.current)} was put back.`,
  onDragCancel: ({ active }) => `Cancelled. ${dragName(active.data.current)} was put back.`,
};

const nextPosition = (slots: Slot[], week: number, day: number, ignoreId?: string) =>
  slots.reduce((max, s) => (s.week === week && s.day === day && s.id !== ignoreId ? Math.max(max, s.position + 1) : max), 0);

/**
 * The program builder: rows are weeks, columns are "Day 1" to "Day 7" counted from the start date the program is
 * assigned with. Drag library workouts onto days and chips between days, or use each day's "+" button and each
 * chip's menu (the keyboard and touch path). Slot changes show at once and are undone, with a message, if saving fails.
 */
export function ProgramGrid({
  program,
  initialSlots,
  library,
}: {
  program: Program;
  initialSlots: Slot[];
  library: LibraryWorkout[];
}) {
  const [slots, setSlots] = useState(initialSlots);
  const [weeks, setWeeks] = useState(program.weeks);
  const [picker, setPicker] = useState<DropData | null>(null);
  const [moving, setMoving] = useState<Slot | null>(null);
  const [dragging, setDragging] = useState<DragData | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [savedOnce, setSavedOnce] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [addingWeek, setAddingWeek] = useState(false);
  // The details as last saved, so "+ Add week" doesn't save half-typed edits.
  const savedDetails = useRef({ name: program.name, description: program.description });
  const dndId = useId();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Show the change now; save it; undo it and say so if saving fails. */
  function optimistic(apply: (s: Slot[]) => Slot[], save: () => Promise<void>, undo: (s: Slot[]) => Slot[]) {
    setSlots(apply);
    setInFlight((n) => n + 1);
    save()
      .then(() => setSavedOnce(true))
      .catch(() => {
        setSlots(undo);
        setToast(SAVE_ERROR);
      })
      .finally(() => setInFlight((n) => n - 1));
  }

  function addSlot(workout: LibraryWorkout, week: number, day: number) {
    const slot: Slot = {
      id: crypto.randomUUID(),
      week,
      day,
      position: nextPosition(slots, week, day),
      workoutId: workout.id,
      workoutName: workout.name,
    };
    optimistic(
      (s) => [...s, slot],
      () => addProgramWorkout({ id: slot.id, programId: program.id, week, day, workoutId: workout.id }),
      (s) => s.filter((x) => x.id !== slot.id),
    );
  }

  function moveSlot(slot: Slot, week: number, day: number) {
    if (slot.week === week && slot.day === day) return;
    const position = nextPosition(slots, week, day, slot.id);
    const before = { week: slot.week, day: slot.day, position: slot.position };
    optimistic(
      (s) => s.map((x) => (x.id === slot.id ? { ...x, week, day, position } : x)),
      () => moveProgramWorkout({ id: slot.id, week, day, position }),
      (s) => s.map((x) => (x.id === slot.id ? { ...x, ...before } : x)),
    );
  }

  function removeSlot(slot: Slot) {
    optimistic(
      (s) => s.filter((x) => x.id !== slot.id),
      () => removeProgramWorkout(slot.id),
      (s) => (s.some((x) => x.id === slot.id) ? s : [...s, slot]),
    );
  }

  function onDragStart(e: DragStartEvent) {
    setDragging((e.active.data.current as DragData | undefined) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const data = e.active.data.current as DragData | undefined;
    const target = e.over?.data.current as DropData | undefined;
    if (!data || !target) return;
    if (data.kind === 'library') addSlot(data.workout, target.week, target.day);
    else moveSlot(data.slot, target.week, target.day);
  }

  async function addWeek() {
    if (weeks >= PROGRAM_WEEKS_MAX) return;
    const next = weeks + 1;
    setWeeks(next);
    setAddingWeek(true);
    try {
      const outcome = await updateProgram(program.id, { ...savedDetails.current, weeks: next });
      if (!outcome.ok) throw new Error(outcome.error);
      setSavedOnce(true);
    } catch {
      setWeeks(next - 1);
      setToast("Couldn't add a week, so it was undone. Please try again.");
    } finally {
      setAddingWeek(false);
    }
  }

  const sorted = [...slots].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const inCell = (week: number, day: number) => sorted.filter((s) => s.week === week && s.day === day);
  const weekNumbers = Array.from({ length: weeks }, (_, i) => i + 1);
  const status = inFlight > 0 ? 'Saving…' : savedOnce ? 'All changes saved' : '';

  return (
    <div className={styles.builder}>
      <ProgramDetails
        program={program}
        weeks={weeks}
        onSaved={(details, newWeeks, removed, expected) => {
          savedDetails.current = details;
          setWeeks(newWeeks);
          setSlots((s) => s.filter((x) => x.week <= newWeeks));
          setSavedOnce(true);
          if (removed !== expected) {
            setToast(`${removed === 1 ? '1 workout was' : `${removed} workouts were`} removed from the weeks you cut.`);
          }
        }}
      />

      <p role="status" className={styles.status}>
        {status}
      </p>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={collision}
        accessibility={{ announcements }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className={styles.workspace}>
          <LibraryPanel library={library} />

          <section className={styles.gridSection} aria-labelledby={`${dndId}-grid`}>
            <h2 id={`${dndId}-grid`} className={styles.sectionHeading}>Weekly plan</h2>
            <p className={styles.caption}>Day 1 is the start date you pick when you assign the program.</p>
            <div className={styles.gridScroll}>
              <table className={styles.grid} aria-label="Program weeks">
                <thead>
                  <tr>
                    <th scope="col" className={styles.weekHead}>
                      <span className={styles.visuallyHidden}>Week</span>
                    </th>
                    {DAYS.map((d) => (
                      <th key={d} scope="col">Day {d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekNumbers.map((w) => (
                    <tr key={w}>
                      <th scope="row" className={styles.weekHead}>Week {w}</th>
                      {DAYS.map((d) => (
                        <td key={d}>
                          <DayCell
                            week={w}
                            day={d}
                            slots={inCell(w, d)}
                            onAdd={() => setPicker({ week: w, day: d })}
                            onMove={setMoving}
                            onRemove={removeSlot}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <Button variant="secondary" onClick={() => void addWeek()} pending={addingWeek} disabled={weeks >= PROGRAM_WEEKS_MAX}>
                + Add week
              </Button>
            </div>
          </section>
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <span className={styles.overlayChip}>
              {dragging.kind === 'library' ? dragging.workout.name : dragging.slot.workoutName}
            </span>
          ) : null}
        </DragOverlay>
      </DndContext>

      {picker ? (
        <WorkoutPicker
          cellLabel={cellLabel(picker.week, picker.day)}
          library={library}
          onPick={(w) => {
            addSlot(w, picker.week, picker.day);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}

      {moving ? (
        <MoveDialog
          slot={moving}
          weeks={weeks}
          onMove={(week, day) => {
            moveSlot(moving, week, day);
            setMoving(null);
          }}
          onClose={() => setMoving(null)}
        />
      ) : null}

      <div className={styles.toastRegion} aria-live="assertive">
        {toast ? (
          <div className={styles.toast}>
            <span>{toast}</span>
            <button type="button" className={styles.smallButton} onClick={() => setToast(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Details (name, description, weeks) ---------- */

function ProgramDetails({
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

  async function save(input: ProgramInput, expected: number) {
    setPending(true);
    setFormError(null);
    try {
      const outcome = await updateProgram(program.id, input);
      if (!outcome.ok) {
        setFormError(outcome.error);
        return;
      }
      onSaved({ name: input.name, description: input.description }, input.weeks, outcome.removedSlots, expected);
    } catch {
      setFormError("Couldn't save. Please try again.");
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
      } catch {
        setPending(false);
        setFormError("Couldn't check the weeks you're removing. Please try again.");
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
        {formError ? <ErrorText className={styles.fullRow}>{formError}</ErrorText> : null}
        <div className={styles.fullRow}>
          <Button type="submit" variant="secondary" pending={pending && !confirm}>
            {pending && !confirm ? 'Saving…' : 'Save details'}
          </Button>
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

/* ---------- Library panel ---------- */

function LibraryPanel({ library }: { library: LibraryWorkout[] }) {
  const [query, setQuery] = useState('');
  const headingId = useId();
  const results = library.filter((w) => matchesSearch(w.name, query));
  return (
    <section className={styles.library} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.sectionHeading}>Library</h2>
      <p className={styles.caption}>Drag a workout onto a day, or use a day&apos;s + button.</p>
      <label className={styles.searchLabel}>
        <span>Search library</span>
        <input type="search" className={styles.input} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ul className={styles.libraryList}>
        {library.length === 0 ? (
          <li className={styles.caption}>No workouts in your library yet.</li>
        ) : results.length === 0 ? (
          <li className={styles.caption}>No workouts match.</li>
        ) : null}
        {results.map((w) => (
          <LibraryItem key={w.id} workout={w} />
        ))}
      </ul>
    </section>
  );
}

function LibraryItem({ workout }: { workout: LibraryWorkout }) {
  const data: DragData = { kind: 'library', workout };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `library-${workout.id}`, data });
  return (
    <li>
      <button
        type="button"
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={cx(styles.libraryItem, isDragging && styles.dragging)}
      >
        {workout.name}
      </button>
    </li>
  );
}

/* ---------- One day ---------- */

function DayCell({
  week,
  day,
  slots,
  onAdd,
  onMove,
  onRemove,
}: {
  week: number;
  day: number;
  slots: Slot[];
  onAdd: () => void;
  onMove: (slot: Slot) => void;
  onRemove: (slot: Slot) => void;
}) {
  const data: DropData = { week, day };
  const { setNodeRef, isOver } = useDroppable({ id: cellId(week, day), data });
  return (
    <div ref={setNodeRef} role="group" aria-label={cellLabel(week, day)} className={cx(styles.cell, isOver && styles.cellOver)}>
      {slots.length > 0 ? (
        <ul className={styles.chips}>
          {slots.map((s) => (
            <SlotChip
              key={s.id}
              slot={s}
              onMove={() => onMove(s)}
              onRemove={() => {
                onRemove(s);
                focusSoon(addButtonDomId(week, day));
              }}
            />
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        id={addButtonDomId(week, day)}
        className={styles.addButton}
        aria-label={`Add a workout to week ${week}, day ${day}`}
        onClick={onAdd}
      >
        +
      </button>
    </div>
  );
}

function SlotChip({ slot, onMove, onRemove }: { slot: Slot; onMove: () => void; onRemove: () => void }) {
  const data: DragData = { kind: 'slot', slot };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `slot-${slot.id}`, data });
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemsRef.current[0]?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onMenuKey(e: KeyboardEvent<HTMLUListElement>) {
    const items = itemsRef.current.filter((x): x is HTMLButtonElement => x !== null);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <li ref={wrapRef} className={cx(styles.chip, isDragging && styles.dragging)}>
      <button
        type="button"
        id={chipDomId(slot.id)}
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={styles.chipHandle}
      >
        {slot.workoutName}
      </button>
      <button
        type="button"
        ref={buttonRef}
        className={styles.chipMenuButton}
        aria-label={`Options for ${slot.workoutName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <ul id={menuId} role="menu" aria-label={`Options for ${slot.workoutName}`} className={styles.menu} onKeyDown={onMenuKey}>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              ref={(el) => {
                itemsRef.current[0] = el;
              }}
              className={styles.menuItem}
              onClick={() => {
                setOpen(false);
                onMove();
              }}
            >
              Move to…
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              ref={(el) => {
                itemsRef.current[1] = el;
              }}
              className={styles.menuItem}
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
            >
              Remove
            </button>
          </li>
        </ul>
      ) : null}
    </li>
  );
}

/* ---------- Move to… ---------- */

function MoveDialog({
  slot,
  weeks,
  onMove,
  onClose,
}: {
  slot: Slot;
  weeks: number;
  onMove: (week: number, day: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [week, setWeek] = useState(Math.min(slot.week, weeks));
  const [day, setDay] = useState(slot.day);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // The menu that opened this is gone, and the chip remounts in its new day: focus the chip there.
    return () => {
      focusSoon(chipDomId(slot.id));
    };
  }, [slot.id]);

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={styles.dialogTitle}>Move {slot.workoutName}</h2>
      <p className={styles.dialogBody}>Now on {cellLabel(slot.week, slot.day)}.</p>
      <div className={styles.moveFields}>
        <SelectField label="Week" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </SelectField>
        <SelectField label="Day" value={day} onChange={(e) => setDay(Number(e.target.value))}>
          {DAYS.map((d) => (
            <option key={d} value={d}>Day {d}</option>
          ))}
        </SelectField>
      </div>
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button onClick={() => onMove(week, day)}>Move</Button>
      </div>
    </dialog>
  );
}
