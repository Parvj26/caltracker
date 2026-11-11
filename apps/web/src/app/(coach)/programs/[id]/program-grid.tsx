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
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { PROGRAM_WEEKS_MAX, copyWeek } from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { Button } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { addProgramWorkout, copyProgramWeek, moveProgramWorkout, removeProgramWorkout, updateProgram } from '../actions';
import { CopyWeekDialog } from './copy-week-dialog';
import { DUPLICATE_NOTE, assignedNote, DAYS, cellLabel, chipDomId, copyWeekButtonDomId, focusSoon } from './grid-ids';
import { LibraryPanel } from './library-panel';
import { LiveSyncPanel } from './live-sync-panel';
import type { LiveSyncState } from '@/lib/live-sync';
import { MoveSlotDialog } from './move-slot-dialog';
import { ProgramDetails } from './program-details';
import { WorkoutPicker } from './workout-picker';
import type { ExercisePrefs, Units, WorkoutHints } from '@caltracker/shared';
import { SlotSummary } from './slot-summary';
import { WorkoutSheet, type SheetSaved, type SheetTarget } from './workout-sheet';
import styles from '../programs.module.css';
import { programWorkoutSaved } from '@/lib/analytics/client';

export type Slot = { id: string; week: number; day: number; position: number; workoutId: string; workoutName: string };
export type LibraryWorkout = { id: string; name: string };
export type Program = { id: string; name: string; description: string | null; weeks: number };

/** What is being dragged: a library workout (adds a slot) or an existing slot (moves it). */
export type DragData = { kind: 'library'; workout: LibraryWorkout } | { kind: 'slot'; slot: Slot };
type DropData = { week: number; day: number };

const cellId = (week: number, day: number) => `cell-${week}-${day}`;
/** DOM ids, so focus can land somewhere sensible after a chip moves or disappears. */
const addButtonDomId = (week: number, day: number) => `program-add-${week}-${day}`;
const SAVE_ERROR = "Couldn't save that change, so it was undone. Please try again.";
const LOCKED_MESSAGE = 'That week is still being copied. Try again in a moment.';

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
  justCopied = false,
  liveSync,
  hints,
  units,
  workspaceId,
  exercisePrefs,
}: {
  program: Program;
  /** The coach's units, for the summary card and the workout editor. */
  units: Units;
  /** The coach's workspace (from requireCoach), for the editor's exercise picker. */
  workspaceId: string;
  /** The workspace's remembered measurements and Each side per exercise, for the workout editor. */
  exercisePrefs: Record<string, ExercisePrefs>;
  initialSlots: Slot[];
  library: LibraryWorkout[];
  /** The program's Live Sync switch and status, as loaded. */
  liveSync: LiveSyncState;
  /** Opened right after "Duplicate" (?copied=1): say once what the copy shares with the original. */
  justCopied?: boolean;
  /** The coach's Recent and Most used workouts, at the top of the day "+" picker. */
  hints?: WorkoutHints;
}) {
  const [slots, setSlots] = useState(initialSlots);
  const [weeks, setWeeks] = useState(program.weeks);
  const [picker, setPicker] = useState<DropData | null>(null);
  const [moving, setMoving] = useState<Slot | null>(null);
  const [viewing, setViewing] = useState<Slot | null>(null);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const router = useRouter();
  const [copying, setCopying] = useState<number | null>(null);
  // Weeks a copy is still saving (a week may appear once per copy in flight).
  const [locked, setLocked] = useState<number[]>([]);
  const [dragging, setDragging] = useState<DragData | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [savedOnce, setSavedOnce] = useState(false);
  // Each saved change bumps this, so the Live Sync status line asks for the new sync time.
  const [saves, setSaves] = useState(0);
  const [live, setLive] = useState(liveSync.on);
  const markSaved = () => {
    setSavedOnce(true);
    setSaves((n) => n + 1);
  };
  const [toast, setToast] = useState<string | null>(justCopied ? `Copied. ${DUPLICATE_NOTE}` : null);
  const [addingWeek, setAddingWeek] = useState(false);
  // The details as last saved, so "+ Add week" doesn't save half-typed edits.
  const savedDetails = useRef({ name: program.name, description: program.description });
  const [savedName, setSavedName] = useState(program.name);
  const dndId = useId();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    // Drop ?copied=1, so a reload doesn't say it again.
    const url = new URL(window.location.href);
    if (url.searchParams.has('copied')) {
      url.searchParams.delete('copied');
      window.history.replaceState(window.history.state, '', url);
    }
  }, []);

  useEffect(() => {
    // The reload prompt stays until the coach acts on it.
    if (!toast || toast === STALE_DEPLOY_MESSAGE) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Show the change now; save it; undo it and say so if saving fails. */
  function optimistic(apply: (s: Slot[]) => Slot[], save: () => Promise<void>, undo: (s: Slot[]) => Slot[]) {
    setSlots(apply);
    setInFlight((n) => n + 1);
    save()
      .then(markSaved)
      .catch((e: unknown) => {
        setSlots(undo);
        setToast(failureMessage(e, SAVE_ERROR));
      })
      .finally(() => setInFlight((n) => n - 1));
  }

  function addSlot(workout: LibraryWorkout, week: number, day: number) {
    if (isLocked(week)) return;
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
      () =>
        addProgramWorkout({ id: slot.id, programId: program.id, week, day, workoutId: workout.id }).then(() => {
          // A new program counts as built once its first workout is saved.
          programWorkoutSaved(program.id);
        }),
      (s) => s.filter((x) => x.id !== slot.id),
    );
  }

  function moveSlot(slot: Slot, week: number, day: number) {
    if (slot.week === week && slot.day === day) return;
    if (isLocked(slot.week, week)) return;
    const position = nextPosition(slots, week, day, slot.id);
    const before = { week: slot.week, day: slot.day, position: slot.position };
    optimistic(
      (s) => s.map((x) => (x.id === slot.id ? { ...x, week, day, position } : x)),
      () => moveProgramWorkout({ id: slot.id, week, day, position }),
      (s) => s.map((x) => (x.id === slot.id ? { ...x, ...before } : x)),
    );
  }

  function removeSlot(slot: Slot) {
    if (isLocked(slot.week)) return;
    optimistic(
      (s) => s.filter((x) => x.id !== slot.id),
      () => removeProgramWorkout(slot.id),
      (s) => (s.some((x) => x.id === slot.id) ? s : [...s, slot]),
    );
  }

  /**
   * Copy a week onto other weeks (replacing them): shown at once and saved in one call with the ids shown here, so
   * the grid and the database agree. While it saves, the weeks involved are locked (no adds, moves or removals), so
   * nothing in them can be lost when the saved slots come back. Undone, with a message, if saving fails.
   */
  function copyWeekTo(from: number, toWeeks: number[]) {
    const plan = copyWeek(slots, { from, to: toWeeks, weeks }, () => crypto.randomUUID());
    if (plan.weeks.length === 0 || plan.added.length === 0) return;
    const addedIds = new Set(plan.added.map((s) => s.id));
    const names = new Map(plan.added.map((s) => [s.workoutId, s.workoutName]));
    const without = (s: Slot[]) => s.filter((x) => !addedIds.has(x.id));
    const undo = () => setSlots((s) => [...without(s), ...plan.removed.filter((r) => !s.some((x) => x.id === r.id))]);
    const lock = [from, ...plan.weeks];
    setSlots((s) => [...s.filter((x) => !plan.weeks.includes(x.week)), ...plan.added]);
    setLocked((l) => [...l, ...lock]);
    setInFlight((n) => n + 1);
    const done = plan.weeks.length === 1 ? `week ${plan.weeks[0]}` : `weeks ${plan.weeks[0]} to ${plan.weeks[plan.weeks.length - 1]}`;
    copyProgramWeek({ programId: program.id, fromWeek: from, toWeeks: plan.weeks, ids: plan.added.map((s) => s.id) })
      .then((outcome) => {
        if (!outcome.ok) {
          undo();
          setToast(outcome.error);
          return;
        }
        // Same ids as shown; take the saved days and order in case the source week differed from this page.
        const saved = outcome.slots.map((x) => ({ ...x, workoutName: names.get(x.workoutId) ?? '' }));
        setSlots((s) => [...without(s), ...saved]);
        markSaved();
        setToast(`Copied week ${from} to ${done}. ${assignedNote(live)}`);
      })
      .catch((e: unknown) => {
        undo();
        setToast(failureMessage(e, "Couldn't copy the week, so nothing changed. Please try again."));
      })
      .finally(() => {
        setInFlight((n) => n - 1);
        setLocked((l) => {
          const next = [...l];
          for (const w of lock) next.splice(next.indexOf(w), 1);
          return next;
        });
      });
  }

  /** True (and says so) when a week is locked by a copy that is still saving. */
  function isLocked(...weeksTouched: number[]): boolean {
    if (!weeksTouched.some((w) => locked.includes(w))) return false;
    setToast(LOCKED_MESSAGE);
    return true;
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

  /** After the editor sheet saves: show the result on the plan, and refresh the page's library list. */
  function onSheetSaved(saved: SheetSaved) {
    setSheet(null);
    if (saved.kind === 'new') {
      addSlot({ id: saved.id, name: saved.name }, saved.week, saved.day);
      setToast(`“${saved.name}” is on ${cellLabel(saved.week, saved.day)} and in your Workouts.`);
    } else if (saved.kind === 'everywhere') {
      setSlots((s) => s.map((x) => (x.workoutId === saved.id ? { ...x, workoutName: saved.name } : x)));
      markSaved();
    } else {
      setSlots((s) => s.map((x) => (x.id === saved.slotId ? { ...x, workoutId: saved.id, workoutName: saved.name } : x)));
      markSaved();
      setToast(`Saved a copy, “${saved.name}”, on this day only.`);
    }
    router.refresh();
  }

  async function addWeek() {
    if (weeks >= PROGRAM_WEEKS_MAX) return;
    const next = weeks + 1;
    setWeeks(next);
    setAddingWeek(true);
    try {
      const outcome = await updateProgram(program.id, { ...savedDetails.current, weeks: next });
      if (!outcome.ok) throw new Error(outcome.error);
      markSaved();
    } catch (e) {
      setWeeks(next - 1);
      setToast(failureMessage(e, "Couldn't add a week, so it was undone. Please try again."));
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
      <LiveSyncPanel programId={program.id} initial={liveSync} refreshKey={saves} onChange={setLive} />
      <ProgramDetails
        program={program}
        weeks={weeks}
        onSaved={(details, newWeeks, removed, expected) => {
          savedDetails.current = details;
          setSavedName(details.name);
          setWeeks(newWeeks);
          setSlots((s) => s.filter((x) => x.week <= newWeeks));
          markSaved();
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
                      <th scope="row" className={styles.weekHead}>
                        Week {w}
                        <div>
                          <button
                            type="button"
                            id={copyWeekButtonDomId(w)}
                            className={styles.smallButton}
                            aria-label={`Copy week ${w}`}
                            onClick={() => setCopying(w)}
                          >
                            Copy…
                          </button>
                        </div>
                      </th>
                      {DAYS.map((d) => (
                        <td key={d}>
                          <DayCell
                            week={w}
                            day={d}
                            slots={inCell(w, d)}
                            onAdd={() => setPicker({ week: w, day: d })}
                            onOpen={setViewing}
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
          hints={hints}
          forProgram
          onNew={() => {
            setSheet({ kind: 'new', week: picker.week, day: picker.day });
            setPicker(null);
          }}
          onPick={(w) => {
            addSlot(w, picker.week, picker.day);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}

      {copying !== null ? (
        <CopyWeekDialog
          week={copying}
          weeks={weeks}
          slots={slots}
          saving={inFlight > 0}
          live={live}
          onCopy={(toWeeks) => {
            copyWeekTo(copying, toWeeks);
            setCopying(null);
          }}
          onClose={() => setCopying(null)}
        />
      ) : null}

      {viewing ? (
        <SlotSummary
          slot={viewing}
          units={units}
          onEdit={(workout) => {
            setSheet({ kind: 'edit', slot: viewing, workout });
            setViewing(null);
          }}
          onMove={() => {
            setMoving(viewing);
            setViewing(null);
          }}
          onRemove={() => {
            removeSlot(viewing);
            setViewing(null);
            focusSoon(addButtonDomId(viewing.week, viewing.day));
          }}
          onClose={() => setViewing(null)}
        />
      ) : null}

      {sheet ? (
        <WorkoutSheet
          programName={savedName}
          target={sheet}
          units={units}
          workspaceId={workspaceId}
          exercisePrefs={exercisePrefs}
          onSaved={onSheetSaved}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {moving ? (
        <MoveSlotDialog
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
            {toast === STALE_DEPLOY_MESSAGE ? <ReloadButton className={styles.smallButton} /> : null}
            <button type="button" className={styles.smallButton} onClick={() => setToast(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- One day ---------- */

function DayCell({
  week,
  day,
  slots,
  onAdd,
  onOpen,
  onMove,
  onRemove,
}: {
  week: number;
  day: number;
  slots: Slot[];
  onAdd: () => void;
  onOpen: (slot: Slot) => void;
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
              onOpen={() => onOpen(s)}
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

function SlotChip({ slot, onOpen, onMove, onRemove }: { slot: Slot; onOpen: () => void; onMove: () => void; onRemove: () => void }) {
  const data: DragData = { kind: 'slot', slot };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `slot-${slot.id}`, data });
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  // Where the pointer went down, so a click that ends a drag doesn't also open the summary.
  const downAt = useRef<{ x: number; y: number } | null>(null);

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
        // Tap (a click without a drag) opens the summary. Enter opens it from the keyboard; Space still picks the chip
        // up to move it. A keyboard click (detail 0, from Space) is the drag's, not a tap.
        onPointerDown={(e) => {
          downAt.current = { x: e.clientX, y: e.clientY };
          listeners?.onPointerDown?.(e);
        }}
        onClick={(e) => {
          const from = downAt.current;
          const moved = from ? Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4 : false;
          if (e.detail > 0 && !moved) onOpen();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onOpen();
            return;
          }
          listeners?.onKeyDown?.(e);
        }}
        className={styles.chipHandle}
        title={slot.workoutName}
      >
        <span className={styles.chipName}>
          <span className={styles.menuSpace} aria-hidden="true" />
          {slot.workoutName}
        </span>
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
