'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type RefObject, type TouchEvent } from 'react';
import { calendarSwipeStep, isLiveWorkout, phoneCalendarDay } from '@caltracker/shared';
import type { IsoDate, WorkoutPreview } from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import { formatDayMonth, formatLongDay, formatShortDay, formatWeekday } from './format';
import styles from './calendar.module.css';

export type CalendarItem = {
  id: string;
  name: string;
  programName: string | null;
  /**
   * The finished log of this planned workout: a string once done, null when none is finished, absent when the
   * calendar doesn't track logging. Matched by the planned workout, never by the log's finish date.
   */
  logId?: string | null;
  /** A workout the client added and finished themselves (no planned workout): a link to its log, never moved. */
  addedByClient?: boolean;
  /** Its first exercises, shown on the taller week-view cards. */
  preview?: WorkoutPreview;
  /** Its finished log was logged by the coach (an in-person session), not by the client. */
  loggedByCoach?: boolean;
  /** From a program assignment: whether its program has Live Sync on, and this copy was edited or started. */
  liveSync?: { programLive: boolean; customised: boolean; started: boolean };
};

type Props = {
  /** Monday-first rows of seven days (from calendarRange). */
  weeks: IsoDate[][];
  /** The month view's "YYYY-MM": days outside it are dimmed. Null in the week views, where every day counts. */
  month: string | null;
  /** The grid's accessible name, e.g. "November 2026" or "2 Nov – 15 Nov 2026". */
  label: string;
  /**
   * 'month': compact cells (names only). 'week': taller cells whose cards preview their exercises, falling back to a
   * list of days when the calendar is narrow.
   */
  layout: 'month' | 'week';
  /** Shown above the grid (the view switcher, TODAY and ‹ ›). */
  toolbar?: ReactNode;
  days: Record<IsoDate, CalendarItem[]>;
  /** The viewer's own today (computed in the browser), or null before it is known. */
  today: IsoDate | null;
  /**
   * Extra controls shown on each item, beside its name (for example an options menu). `editable` is false on days
   * before `editableFrom`, so the controls can offer less there.
   */
  renderItem: (item: CalendarItem, date: IsoDate, editable: boolean) => ReactNode;
  /** Where an item's finished log lives, for its "✓" link. */
  logHref?: (logId: string) => string;
  /**
   * Where a click anywhere on an item's card goes (its log once done, otherwise the workout), or null for a card that
   * opens nothing. Mouse and touch only: keyboard users keep the name button (drag) and the "⋯" menu.
   */
  itemHref?: (item: CalendarItem, editable: boolean) => string | null;
  /** Present: items can be dragged onto other days. Absent: item names are plain text. */
  onDropItem?: (itemId: string, date: IsoDate) => void;
  /** Present: each day has a "+" button. */
  onAddToDay?: (date: IsoDate) => void;
  /**
   * Days before this are read-only: no "+", not a drop target, and their items can't be dragged (renderItem is
   * told, so it can offer fewer controls).
   */
  editableFrom?: IsoDate;
  /**
   * Present: a sideways finger swipe across the calendar steps it (1 = on, -1 = back), as the toolbar's › and ‹ do.
   * A swipe that starts on a workout card is left to the card (a long press drags it).
   */
  onSwipe?: (step: -1 | 1) => void;
};

/** At or below this width the month view shows a dot per day and the picked day's workouts under the grid. */
const COMPACT_MAX_PX = 600;
/** Touches this close to the screen's sides are the browser's back and forward swipes, not the calendar's. */
const EDGE_PX = 24;

type DragData = { item: CalendarItem; from: IsoDate };
type DropData = { date: IsoDate };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const NONE: CalendarItem[] = [];

// Pointer first (exact for the mouse); the keyboard sensor has no pointer, so fall back to overlap.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};
const dragName = (data: unknown) => (data as DragData | undefined)?.item.name ?? 'workout';
const dropName = (data: unknown) => {
  const d = data as DropData | undefined;
  return d ? formatLongDay(d.date) : 'nowhere';
};
const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${dragName(active.data.current)}.`,
  onDragOver: ({ active, over }) =>
    over ? `${dragName(active.data.current)} is over ${dropName(over.data.current)}.` : `${dragName(active.data.current)} is not over a day.`,
  onDragEnd: ({ active, over }) =>
    over ? `Dropped ${dragName(active.data.current)} on ${dropName(over.data.current)}.` : `${dragName(active.data.current)} was put back.`,
  onDragCancel: ({ active }) => `Cancelled. ${dragName(active.data.current)} was put back.`,
};

/**
 * Monday-first weeks of days: a month, or 1, 2 or 4 weeks. Each day cell carries data-date; today has an ink ring and
 * aria-current="date". Items can be dragged between days (mouse, touch, or keyboard: Space to pick up, arrows, Space
 * to drop); the "+" button and the item controls from renderItem are the non-drag path. When the calendar is narrow
 * (a phone), the month view is a grid of dots (a dot on each day with workouts) and the picked day's workouts show
 * under it; a long press on one of those cards can still drop it on another day of the grid.
 */
export function MonthCalendar({ weeks, month, label, layout, toolbar, days, today, renderItem, logHref, itemHref, onDropItem, onAddToDay, editableFrom, onSwipe }: Props) {
  const dndId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<CalendarItem | null>(null);
  const sensors = useSensors(
    // Mouse: a drag starts after 4 px, so a plain click still opens the card. Touch: a long press picks the card up,
    // so a normal swipe across cards still scrolls the calendar (iPad).
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const draggable = Boolean(onDropItem);
  const narrow = useNarrow(rootRef, COMPACT_MAX_PX);
  const compact = narrow && layout === 'month';
  const [picked, setPicked] = useState<IsoDate | null>(null);
  const first = weeks[0]![0]!;
  const last = weeks.at(-1)!.at(-1)!;
  const shownDay = today ? phoneCalendarDay({ start: first, end: last, month }, today, picked) : (picked ?? first);
  const swipe = useSwipe(scrollRef, onSwipe, dragging !== null);

  function onDragStart(e: DragStartEvent) {
    setDragging((e.active.data.current as DragData | undefined)?.item ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const data = e.active.data.current as DragData | undefined;
    const target = e.over?.data.current as DropData | undefined;
    if (!data || !target || data.from === target.date) return;
    onDropItem?.(data.item.id, target.date);
  }
  const editableOn = (date: IsoDate) => editableFrom === undefined || date >= editableFrom;
  const shownEditable = editableOn(shownDay);

  return (
    <div ref={rootRef} className={cx(styles.calendar, layout === 'week' && styles.weekLayout, compact && styles.compact)} {...swipe}>
      {toolbar}

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={collision}
        accessibility={{ announcements }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div ref={scrollRef} className={styles.scroll}>
          <table className={styles.grid} aria-label={label}>
            <thead>
              <tr>
                {WEEKDAYS.map((d) => (
                  <th key={d} scope="col">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0]}>
                  {week.map((date) => {
                    const editable = editableOn(date);
                    const inMonth = month === null || date.startsWith(`${month}-`);
                    return (
                      <td key={date}>
                        {compact ? (
                          <DotDay
                            date={date}
                            count={(days[date] ?? NONE).length}
                            inMonth={inMonth}
                            isToday={date === today}
                            selected={date === shownDay}
                            droppable={draggable && editable}
                            dragActive={dragging !== null}
                            onPick={() => setPicked(date)}
                          />
                        ) : (
                          <DayCell
                            date={date}
                            items={days[date] ?? NONE}
                            inMonth={inMonth}
                            layout={layout}
                            firstShown={date === first}
                            isToday={date === today}
                            draggable={draggable && editable}
                            dragActive={dragging !== null}
                            renderItem={renderItem}
                            logHref={logHref}
                            itemHref={itemHref}
                            today={today}
                            editable={editable}
                            {...(onAddToDay && editable ? { onAdd: () => onAddToDay(date) } : {})}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {compact ? (
          <DayPanel
            date={shownDay}
            items={days[shownDay] ?? NONE}
            draggable={draggable && shownEditable}
            editable={shownEditable}
            renderItem={renderItem}
            logHref={logHref}
            itemHref={itemHref}
            today={today}
            {...(onAddToDay && shownEditable ? { onAdd: () => onAddToDay(shownDay) } : {})}
          />
        ) : null}
        <DragOverlay dropAnimation={null}>
          {dragging ? <span className={styles.overlayItem}>{dragging.name}</span> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/** True while the element is at most `maxPx` wide (false on the server and until it has been measured). */
function useNarrow(ref: RefObject<HTMLElement | null>, maxPx: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNarrow(entry.contentRect.width > 0 && entry.contentRect.width <= maxPx);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, maxPx]);
  return narrow;
}

/**
 * Touch handlers that turn a sideways swipe into onSwipe. Ignored: swipes that start on a workout card or its
 * controls (a long press there drags the card), next to the screen's sides (the browser's own back swipe), with two
 * fingers, during a drag, or on a grid that scrolls sideways itself.
 */
function useSwipe(scrollRef: RefObject<HTMLElement | null>, onSwipe: Props['onSwipe'], dragActive: boolean) {
  const start = useRef<{ x: number; y: number } | null>(null);
  if (!onSwipe) return {};
  return {
    onTouchStart: (event: TouchEvent<HTMLDivElement>) => {
      start.current = null;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) return;
      const target = event.target as HTMLElement;
      if (target.closest('[data-calendar-card], [data-item-controls], dialog, input, select, textarea')) return;
      if (touch.clientX < EDGE_PX || touch.clientX > window.innerWidth - EDGE_PX) return;
      const scroller = scrollRef.current;
      if (scroller && scroller.contains(target) && scroller.scrollWidth > scroller.clientWidth + 1) return;
      start.current = { x: touch.clientX, y: touch.clientY };
    },
    onTouchMove: (event: TouchEvent<HTMLDivElement>) => {
      if (event.touches.length !== 1) start.current = null;
    },
    onTouchEnd: (event: TouchEvent<HTMLDivElement>) => {
      const from = start.current;
      start.current = null;
      const touch = event.changedTouches[0];
      if (!from || !touch || dragActive) return;
      const step = calendarSwipeStep({ dx: touch.clientX - from.x, dy: touch.clientY - from.y });
      if (step !== 0) onSwipe(step);
    },
    onTouchCancel: () => {
      start.current = null;
    },
  };
}

const workoutCount = (n: number) => (n === 0 ? 'no workouts' : n === 1 ? '1 workout' : `${n} workouts`);

/** A phone month's day: its number, and a dot when it has workouts. A tap shows its workouts under the grid. */
function DotDay({
  date,
  count,
  inMonth,
  isToday,
  selected,
  droppable,
  dragActive,
  onPick,
}: {
  date: IsoDate;
  count: number;
  inMonth: boolean;
  isToday: boolean;
  selected: boolean;
  /** Takes a card dragged from the picked day's list under the grid. */
  droppable: boolean;
  dragActive: boolean;
  onPick: () => void;
}) {
  const data: DropData = { date };
  const { setNodeRef, isOver } = useDroppable({ id: `day-${date}`, data, disabled: !droppable });
  const drop = dragActive ? (droppable ? 'open' : 'locked') : undefined;
  return (
    <div
      ref={setNodeRef}
      data-date={date}
      data-drop={drop}
      className={cx(
        styles.day,
        styles.dotDay,
        !inMonth && styles.otherMonth,
        isToday && styles.today,
        selected && styles.dotDaySelected,
        drop === 'open' && styles.dropOpen,
        drop === 'locked' && styles.dropLocked,
        isOver && styles.dayOver,
      )}
    >
      <button
        type="button"
        className={styles.dotButton}
        aria-pressed={selected}
        aria-current={isToday ? 'date' : undefined}
        aria-label={`${formatLongDay(date)}: ${workoutCount(count)}`}
        onClick={onPick}
      >
        <span className={styles.dayNumber} aria-hidden="true">{Number(date.slice(8))}</span>
        <span className={cx(styles.dot, count === 0 && styles.dotEmpty)} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Under a phone month's dots: the picked day's workouts (as in a week view) and its "+". */
function DayPanel({
  date,
  items,
  draggable,
  editable,
  renderItem,
  logHref,
  itemHref,
  today,
  onAdd,
}: {
  date: IsoDate;
  items: CalendarItem[];
  draggable: boolean;
  editable: boolean;
  renderItem: Props['renderItem'];
  logHref: Props['logHref'];
  itemHref: Props['itemHref'];
  today: IsoDate | null;
  onAdd?: () => void;
}) {
  const headingId = useId();
  return (
    <section className={styles.dayPanel} aria-labelledby={headingId} data-day-panel={date}>
      <h3 id={headingId} className={styles.dayPanelTitle} aria-live="polite">
        {formatLongDay(date)}
      </h3>
      {items.length > 0 ? (
        <DayItems
          date={date}
          items={items}
          draggable={draggable}
          editable={editable}
          renderItem={renderItem}
          logHref={logHref}
          itemHref={itemHref}
          today={today}
          showPreview
        />
      ) : (
        <p className={styles.dayPanelEmpty}>No workouts</p>
      )}
      {onAdd ? <AddButton date={date} onAdd={onAdd} /> : null}
    </section>
  );
}

function DayCell({
  date,
  items,
  inMonth,
  layout,
  firstShown,
  isToday,
  draggable,
  dragActive,
  editable,
  renderItem,
  logHref,
  itemHref,
  today,
  onAdd,
}: {
  date: IsoDate;
  layout: Props['layout'];
  /** The first day on screen: the week views name its month. */
  firstShown: boolean;
  today: IsoDate | null;
  logHref: Props['logHref'];
  itemHref: Props['itemHref'];
  items: CalendarItem[];
  inMonth: boolean;
  isToday: boolean;
  draggable: boolean;
  /** A card is being dragged: days that take a drop are outlined, locked (past) days fade back. */
  dragActive: boolean;
  editable: boolean;
  renderItem: Props['renderItem'];
  onAdd?: () => void;
}) {
  const data: DropData = { date };
  const { setNodeRef, isOver } = useDroppable({ id: `day-${date}`, data, disabled: !draggable });
  // While a card is dragged, every day says whether it takes the drop: "open" (outlined) or "locked" (faded).
  const drop = dragActive ? (draggable ? 'open' : 'locked') : undefined;
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={formatLongDay(date)}
      aria-current={isToday ? 'date' : undefined}
      data-date={date}
      data-drop={drop}
      className={cx(
        styles.day,
        !inMonth && styles.otherMonth,
        isToday && styles.today,
        drop === 'open' && styles.dropOpen,
        drop === 'locked' && styles.dropLocked,
        isOver && styles.dayOver,
      )}
    >
      {layout === 'month' ? (
        <span className={styles.dayNumber} aria-hidden="true">{Number(date.slice(8))}</span>
      ) : (
        // The weekday shows only when the days are a list (narrow screens); the columns have it otherwise. The month
        // shows on the first day on screen and on each 1st.
        <span className={styles.dayNumber} aria-hidden="true">
          <span className={styles.dayWeekday}>{formatWeekday(date)} </span>
          {firstShown || date.endsWith('-01') ? formatDayMonth(date) : Number(date.slice(8))}
        </span>
      )}
      {items.length > 0 ? (
        <DayItems
          date={date}
          items={items}
          draggable={draggable}
          editable={editable}
          renderItem={renderItem}
          logHref={logHref}
          itemHref={itemHref}
          today={today}
          showPreview={layout === 'week'}
        />
      ) : null}
      {onAdd ? <AddButton date={date} onAdd={onAdd} /> : null}
    </div>
  );
}

/** A day's workout cards (a grid cell's, or the phone month's picked day's). */
function DayItems({
  date,
  items,
  draggable,
  editable,
  renderItem,
  logHref,
  itemHref,
  today,
  showPreview,
}: {
  date: IsoDate;
  items: CalendarItem[];
  draggable: boolean;
  editable: boolean;
  renderItem: Props['renderItem'];
  logHref: Props['logHref'];
  itemHref: Props['itemHref'];
  today: IsoDate | null;
  showPreview: boolean;
}) {
  return (
    <ul className={styles.items}>
      {items.map((item) =>
        item.addedByClient && item.logId && logHref ? (
          <ClientAddedItem key={item.id} name={item.name} href={logHref(item.logId)} />
        ) : (
          <DayItem
            key={item.id}
            item={item}
            date={date}
            // A done workout stays on the day it was done.
            draggable={draggable && !item.logId}
            lockedDone={draggable && Boolean(item.logId)}
            editable={editable}
            renderItem={renderItem}
            logHref={logHref}
            showPreview={showPreview}
            href={itemHref ? itemHref(item, editable) : null}
            missed={item.logId === null && today !== null && date < today}
            live={item.liveSync !== undefined && today !== null && isLiveWorkout({ ...item.liveSync, date }, today)}
          />
        ),
      )}
    </ul>
  );
}

/** A day's "+": adds a workout to that day. */
function AddButton({ date, onAdd }: { date: IsoDate; onAdd: () => void }) {
  return (
    <button
      type="button"
      id={calendarAddDomId(date)}
      className={styles.addButton}
      aria-label={`Add workout to ${formatShortDay(date)}`}
      title={`Add workout to ${formatShortDay(date)}`}
      onClick={onAdd}
    >
      <span aria-hidden="true">+</span>
      {/* The title is a mouse-only tooltip; this shows the same words to keyboard users on focus. */}
      <span aria-hidden="true" className={styles.addTip}>
        Add workout to {formatShortDay(date)}
      </span>
    </button>
  );
}

function DayItem({
  item,
  date,
  draggable,
  lockedDone,
  editable,
  renderItem,
  logHref,
  href,
  missed,
  showPreview,
  live,
}: {
  item: CalendarItem;
  /** The week views' taller cards: up to three exercise lines and "+ N more exercises". */
  showPreview: boolean;
  logHref: Props['logHref'];
  /** Where a click anywhere on the card goes, or null. */
  href: string | null;
  /** Planned, its day has passed (in the viewer's zone) and no finished log. */
  missed: boolean;
  /** Kept up to date by the program's Live Sync. */
  live: boolean;
  date: IsoDate;
  draggable: boolean;
  /** Done, on a day that could otherwise take moves: it stays put, and an attempt to drag it says why. */
  lockedDone: boolean;
  editable: boolean;
  renderItem: Props['renderItem'];
}) {
  const data: DragData = { item, from: date };
  // The whole card is the drag source (mouse, or a long press on touch). The name button stays the keyboard handle: it carries the
  // a11y attributes and is the activator node, so Space on the "⋯" menu never picks the card up.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: `item-${item.id}`, data, disabled: !draggable });
  // The item's controls (its "⋯" menu) sit in the top-right corner; the name leaves room for them.
  const controls = renderItem(item, date, editable);
  const router = useRouter();
  // A drag ends with a click on the card; that click must not also open it. dnd-kit already swallows it; this
  // is a guard for the moment the drag ends. The flag clears just after every drag ends (dropped on another day, its
  // own day, a past day, or cancelled with Esc), so the next real click always opens the card.
  const dragged = useRef(false);
  useEffect(() => {
    if (isDragging) {
      dragged.current = true;
      return;
    }
    if (!dragged.current) return;
    const timer = setTimeout(() => {
      dragged.current = false;
    }, 0);
    return () => clearTimeout(timer);
  }, [isDragging]);
  // A done card can't move: pressing on it and moving past the drag distance shows why, and that release doesn't open it.
  const [lockedTip, setLockedTip] = useState(false);
  const press = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!lockedTip) return;
    const timer = setTimeout(() => setLockedTip(false), 2500);
    return () => clearTimeout(timer);
  }, [lockedTip]);
  const lockedHandlers = lockedDone
    ? {
        // Mouse only: on touch a swipe across a done card is a scroll.
        onPointerDown: (event: PointerEvent<HTMLLIElement>) => {
          if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target as HTMLElement).closest('a, button, [data-item-controls]')) return;
          press.current = { x: event.clientX, y: event.clientY };
        },
        onPointerMove: (event: PointerEvent<HTMLLIElement>) => {
          const p = press.current;
          if (!p || Math.hypot(event.clientX - p.x, event.clientY - p.y) < 4) return;
          press.current = null;
          dragged.current = true;
          setLockedTip(true);
        },
        onPointerUp: () => {
          press.current = null;
          if (!dragged.current) return;
          setTimeout(() => {
            dragged.current = false;
          }, 0);
        },
      }
    : {};
  const target = (event: MouseEvent<HTMLLIElement>) =>
    // The "⋯" menu, its dialogs and the "✓ Done" link keep their own behaviour.
    !dragged.current && href && !(event.target as HTMLElement).closest('a, [data-item-controls]') ? href : null;
  const openCard = (event: MouseEvent<HTMLLIElement>) => {
    const to = target(event);
    if (!to) return;
    if (event.metaKey || event.ctrlKey) window.open(to, '_blank', 'noopener');
    else router.push(to);
  };
  // Middle-click opens the card in a new tab, like a link.
  const openCardInTab = (event: MouseEvent<HTMLLIElement>) => {
    const to = event.button === 1 ? target(event) : null;
    if (!to) return;
    event.preventDefault();
    window.open(to, '_blank', 'noopener');
  };
  return (
    // A mouse and touch shortcut: the name button and the "⋯" menu stay the keyboard and screen-reader way in.
    <li
      ref={draggable ? setNodeRef : undefined}
      data-calendar-card
      {...(draggable ? listeners : lockedHandlers)}
      className={cx(
        styles.item,
        item.programName ? styles.programItem : styles.singleItem,
        isDragging && styles.dragging,
        missed && styles.missed,
        href && styles.clickable,
        draggable && styles.grab,
        lockedDone && styles.locked,
      )}
      title={lockedDone ? DONE_STAYS : undefined}
      onClick={openCard}
      onAuxClick={openCardInTab}
    >
      <div className={styles.itemRow}>
        {draggable ? (
          <button
            type="button"
            id={calendarItemDomId(item.id)}
            ref={setActivatorNodeRef}
            {...attributes}
            className={cx(styles.itemHandle, styles.grab)}
            title={item.name}
          >
            <span className={styles.itemName}>
              {controls ? <span className={styles.menuSpace} aria-hidden="true" /> : null}
              {item.name}
            </span>
          </button>
        ) : (
          // Read-only calendar: the name is plain text.
          <span className={styles.itemHandle} title={item.name}>
            <span className={styles.itemName}>
              {controls ? <span className={styles.menuSpace} aria-hidden="true" /> : null}
              {item.name}
            </span>
          </span>
        )}
        {controls ? (
          // Its buttons and dialogs keep their own clicks: pressing them never starts a card drag.
          <div className={styles.itemControls} data-item-controls {...keepPress}>
            {controls}
          </div>
        ) : null}
      </div>
      {showPreview && item.preview && item.preview.lines.length > 0 ? (
        <div className={styles.cardPreview}>
          {item.preview.lines.map((line, i) => (
            <span key={i} className={styles.previewLine} title={line.text}>
              <span aria-hidden="true">{line.text}</span>
              <span className={styles.srOnly}>{line.spoken}</span>
            </span>
          ))}
          {item.preview.more > 0 ? (
            <span className={styles.previewMore}>
              + {item.preview.more} more {item.preview.more === 1 ? 'exercise' : 'exercises'}
            </span>
          ) : null}
        </div>
      ) : null}
      {item.logId && logHref ? (
        <Link href={logHref(item.logId)} className={styles.doneNote} aria-label={`Done: view the ${item.name} log`} {...keepPress}>
          <span aria-hidden="true">✓</span> Done
        </Link>
      ) : null}
      {item.logId && item.loggedByCoach ? <span className={styles.coachNote}>Logged by coach</span> : null}
      {missed ? <span className={styles.missedNote}>Missed</span> : null}
      {lockedTip ? (
        <span role="status" className={styles.lockedTip}>
          {DONE_STAYS}
        </span>
      ) : null}
      {item.programName ? (
        <span className={styles.itemProgram}>
          {item.programName}
          {live ? (
            <span className={styles.liveTag} title="Live Sync: changes to the program update this workout">
              {' · '}Live
            </span>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

const DONE_STAYS = 'Done workouts stay on the day they were done';
/** Presses on these keep their own behaviour: they never reach the card's drag sensors (mouse, touch) or done-card tip. */
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
const keepPress = { onPointerDown: stop, onMouseDown: stop, onTouchStart: stop };

/** A workout the client added on the phone: a different look, "Added by client", and the whole card opens the log. */
function ClientAddedItem({ name, href }: { name: string; href: string }) {
  return (
    <li className={cx(styles.item, styles.clientItem)} data-calendar-card>
      <Link href={href} className={styles.clientLink} title={name} aria-label={`${name}, added by client: view the log`}>
        <span className={styles.itemName}>{name}</span>
        <span className={styles.clientTag}>
          <span aria-hidden="true">✓</span> Added by client
        </span>
      </Link>
    </li>
  );
}

/** DOM id of an item's name button, so focus can return to it after a move. */
export const calendarItemDomId = (itemId: string) => `calendar-item-${itemId}`;
/** DOM id of a day's "+" button, so focus has somewhere to go after an item is deleted. */
export const calendarAddDomId = (date: IsoDate) => `calendar-add-${date}`;
