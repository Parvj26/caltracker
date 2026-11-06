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
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { monthGrid } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import { formatLongDay, formatMonth, formatShortDay, shiftMonth } from './format';
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
};

type Props = {
  /** "YYYY-MM". */
  month: string;
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
};

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
 * A Monday-first month of days. Each day cell carries data-date; today has an ink ring and aria-current="date".
 * Items can be dragged between days (mouse, touch, or keyboard: Space to pick up, arrows, Space to drop); the "+"
 * button and the item controls from renderItem are the non-drag path.
 */
export function MonthCalendar({ month, days, today, renderItem, logHref, itemHref, onDropItem, onAddToDay, editableFrom }: Props) {
  const pathname = usePathname();
  const dndId = useId();
  const [dragging, setDragging] = useState<CalendarItem | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const weeks = monthGrid(month);
  const draggable = Boolean(onDropItem);

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

  return (
    <div className={styles.calendar}>
      <div className={styles.monthBar}>
        <Link href={`${pathname}?month=${shiftMonth(month, -1)}`} className={styles.monthLink} aria-label="Previous month">
          <span aria-hidden="true">←</span>
        </Link>
        <h2 className={styles.monthTitle} aria-live="polite">{formatMonth(month)}</h2>
        <Link href={`${pathname}?month=${shiftMonth(month, 1)}`} className={styles.monthLink} aria-label="Next month">
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={collision}
        accessibility={{ announcements }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className={styles.scroll}>
          <table className={styles.grid} aria-label={formatMonth(month)}>
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
                    const editable = editableFrom === undefined || date >= editableFrom;
                    return (
                      <td key={date}>
                        <DayCell
                          date={date}
                          items={days[date] ?? NONE}
                          inMonth={date.startsWith(`${month}-`)}
                          isToday={date === today}
                          draggable={draggable && editable}
                          renderItem={renderItem}
                          logHref={logHref}
                          itemHref={itemHref}
                          today={today}
                          editable={editable}
                          {...(onAddToDay && editable ? { onAdd: () => onAddToDay(date) } : {})}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? <span className={styles.overlayItem}>{dragging.name}</span> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function DayCell({
  date,
  items,
  inMonth,
  isToday,
  draggable,
  editable,
  renderItem,
  logHref,
  itemHref,
  today,
  onAdd,
}: {
  date: IsoDate;
  today: IsoDate | null;
  logHref: Props['logHref'];
  itemHref: Props['itemHref'];
  items: CalendarItem[];
  inMonth: boolean;
  isToday: boolean;
  draggable: boolean;
  editable: boolean;
  renderItem: Props['renderItem'];
  onAdd?: () => void;
}) {
  const data: DropData = { date };
  const { setNodeRef, isOver } = useDroppable({ id: `day-${date}`, data, disabled: !draggable });
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={formatLongDay(date)}
      aria-current={isToday ? 'date' : undefined}
      data-date={date}
      className={cx(styles.day, !inMonth && styles.otherMonth, isToday && styles.today, isOver && styles.dayOver)}
    >
      <span className={styles.dayNumber} aria-hidden="true">{Number(date.slice(8))}</span>
      {items.length > 0 ? (
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
              editable={editable}
              renderItem={renderItem}
              logHref={logHref}
              href={itemHref ? itemHref(item, editable) : null}
              missed={item.logId === null && today !== null && date < today}
            />
            ),
          )}
        </ul>
      ) : null}
      {onAdd ? (
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
      ) : null}
    </div>
  );
}

function DayItem({
  item,
  date,
  draggable,
  editable,
  renderItem,
  logHref,
  href,
  missed,
}: {
  item: CalendarItem;
  logHref: Props['logHref'];
  /** Where a click anywhere on the card goes, or null. */
  href: string | null;
  /** Planned, its day has passed (in the viewer's zone) and no finished log. */
  missed: boolean;
  date: IsoDate;
  draggable: boolean;
  editable: boolean;
  renderItem: Props['renderItem'];
}) {
  const data: DragData = { item, from: date };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `item-${item.id}`, data, disabled: !draggable });
  // The item's controls (its "⋯" menu) sit in the top-right corner; the name leaves room for them.
  const controls = renderItem(item, date, editable);
  const router = useRouter();
  // A drag ends with a click on the handle; that click must not also open the card.
  const dragged = useRef(false);
  useEffect(() => {
    if (isDragging) dragged.current = true;
  }, [isDragging]);
  const openCard = (event: MouseEvent<HTMLLIElement>) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    // The "⋯" menu, its dialogs and the "✓ Done" link keep their own behaviour.
    if (!href || (event.target as HTMLElement).closest('a, [data-item-controls]')) return;
    if (event.metaKey || event.ctrlKey) window.open(href, '_blank', 'noopener');
    else router.push(href);
  };
  return (
    // A mouse and touch shortcut: the name button and the "⋯" menu stay the keyboard and screen-reader way in.
    <li
      className={cx(styles.item, item.programName ? styles.programItem : styles.singleItem, isDragging && styles.dragging, missed && styles.missed, href && styles.clickable)}
      onClick={openCard}
    >
      <div className={styles.itemRow}>
        {draggable ? (
          <button
            type="button"
            id={calendarItemDomId(item.id)}
            ref={setNodeRef}
            {...attributes}
            {...listeners}
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
          <div className={styles.itemControls} data-item-controls>
            {controls}
          </div>
        ) : null}
      </div>
      {item.logId && logHref ? (
        <Link href={logHref(item.logId)} className={styles.doneNote} aria-label={`Done: view the ${item.name} log`}>
          <span aria-hidden="true">✓</span> Done
        </Link>
      ) : null}
      {missed ? <span className={styles.missedNote}>Missed</span> : null}
      {item.programName ? <span className={styles.itemProgram}>{item.programName}</span> : null}
    </li>
  );
}

/** A workout the client added on the phone: a different look, "Added by client", and the whole card opens the log. */
function ClientAddedItem({ name, href }: { name: string; href: string }) {
  return (
    <li className={cx(styles.item, styles.clientItem)}>
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
