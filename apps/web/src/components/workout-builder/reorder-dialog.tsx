'use client';

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { blockBadges, type BlockKind } from '@caltracker/shared';
import { AdaptiveDialog, Button, type AdaptiveDialogHandle } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import styles from './builder.module.css';

export type ReorderItem = {
  id: string;
  kind: BlockKind;
  /** "Superset" for a superset, "Pick one" for a pick-one group, else null. */
  tag: string | null;
  names: string[];
};

export type ReorderRun = { key: string; section: string | null; items: ReorderItem[] };

const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
};

/** How long neighbours take to slide into their new places, and the dropped row to settle (ms). */
const SLIDE_MS = 180;
const DROP_MS = 160;
const LIFT = 'scale(1.03)';

const stillMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** A light tap where the device has one (Android Chrome; iOS Safari has no vibrate and ignores it). */
const tick = () => {
  try {
    navigator.vibrate?.(10);
  } catch {
    // Some browsers throw when vibration is blocked; it's only a nicety.
  }
};

/**
 * "Reorder exercises": just the names, in order. Drag a row by its handle (mouse, finger or pen) or use ↑ and ↓. The
 * lifted row grows a little and follows the finger, the others slide aside (FLIP), and it eases into place on drop;
 * a light vibration marks pick-up and drop where supported. Reduced motion: no movement, rows just swap. A
 * superset moves as one block, and each block stays in its section. Each row shows the builder's badge (1, A1, A2…).
 * Cancel (or ×, Back) leaves the workout as it was, asking first once something moved; Done applies the new order.
 */
export function ReorderDialog({ runs, onDone, onClose }: { runs: readonly ReorderRun[]; onDone: (ids: string[]) => void; onClose: () => void }) {
  const ref = useRef<AdaptiveDialogHandle>(null);
  const [order, setOrder] = useState(() => runs.map((r) => r.items));
  const ids = order.flatMap((items) => items.map((x) => x.id));
  const dirty = ids.join() !== runs.flatMap((r) => r.items.map((x) => x.id)).join();
  // The builder's own badges (1, A1, A2, 3…) for the order as it stands, so they follow each move.
  const flatBadges = blockBadges(order.flat().map((x) => ({ kind: x.kind, exercises: x.names })));
  const badgeOf = new Map(order.flat().map((x, i) => [x.id, flatBadges[i]!]));
  const [dragging, setDragging] = useState<string | null>(null);
  const lists = useRef<(HTMLOListElement | null)[]>([]);
  // The drag in progress: which run, where the finger grabbed the row (px from its top) and the finger's last y.
  const drag = useRef<{ run: number; id: string; grab: number; y: number } | null>(null);
  // Each row's top on screen just before the order changed (mid-slide too), for the FLIP slide.
  const before = useRef<Map<string, number> | null>(null);

  const rowEl = (run: number, id: string) =>
    [...(lists.current[run]?.children ?? [])].find((el): el is HTMLLIElement => (el as HTMLElement).dataset.id === id);

  /** Keeps the lifted row under the finger: its natural place plus whatever the finger moved past it. */
  const follow = () => {
    const d = drag.current;
    if (!d) return;
    const li = rowEl(d.run, d.id);
    const list = lists.current[d.run];
    if (!li || !list) return;
    if (stillMotion()) return;
    const natural = list.getBoundingClientRect().top + li.offsetTop;
    li.style.transform = `translateY(${d.y - d.grab - natural}px) ${LIFT}`;
  };

  const remember = (run: number) => {
    before.current = new Map([...(lists.current[run]?.children ?? [])].map((el) => [(el as HTMLElement).dataset.id ?? '', el.getBoundingClientRect().top]));
  };

  /** Moves a block to place `to` of its run (by id, so moves that come faster than renders still land right). */
  const shift = (run: number, id: string, to: number) => {
    if (to < 0 || to >= order[run]!.length) return;
    remember(run);
    setOrder((o) =>
      o.map((items, r) => {
        const from = items.findIndex((x) => x.id === id);
        return r === run && from >= 0 && from !== to ? move(items, from, to) : items;
      }),
    );
  };

  // After a move: the rows that changed place slide from where they were (transform only, so nothing reflows), and
  // the lifted row stays under the finger. With reduced motion everything just jumps.
  useLayoutEffect(() => {
    const old = before.current;
    before.current = null;
    if (!old) return;
    follow();
    if (stillMotion()) return;
    for (const list of lists.current) {
      for (const el of [...(list?.children ?? [])] as HTMLElement[]) {
        const id = el.dataset.id ?? '';
        const was = old.get(id);
        if (was === undefined || id === drag.current?.id) continue;
        el.style.transition = 'none';
        el.style.transform = '';
        const delta = was - el.getBoundingClientRect().top;
        if (Math.abs(delta) < 0.5) continue;
        el.style.transform = `translateY(${delta}px)`;
        // Commit the start position before turning the transition on.
        el.getBoundingClientRect();
        el.style.transition = `transform ${SLIDE_MS}ms ease`;
        el.style.transform = '';
      }
    }
    // follow() only reads refs; the slide runs once per new order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  // The drag follows the pointer on the whole window: the row (and its handle) moves in the list as it is dragged,
  // which can drop a pointer capture on the handle.
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  const onDown = (run: number, id: string) => (e: PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    endDrag.current?.();
    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId === e.pointerId) onDrag(run, id, ev.clientY);
    };
    const up = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      endDrag.current?.();
      onUp(run, id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    endDrag.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      endDrag.current = null;
    };
    const li = rowEl(run, id);
    drag.current = { run, id, grab: li ? e.clientY - li.getBoundingClientRect().top : 0, y: e.clientY };
    if (li && !stillMotion()) {
      li.style.transition = `transform ${DROP_MS}ms ease-out, box-shadow ${DROP_MS}ms ease-out`;
      li.style.transform = LIFT;
    }
    tick();
    setDragging(id);
  };

  const onDrag = (run: number, id: string, y: number) => {
    const d = drag.current;
    if (!d || d.id !== id) return;
    d.y = y;
    const li = rowEl(run, id);
    if (li) li.style.transition = 'box-shadow 120ms ease-out';
    follow();
    const rows = [...(lists.current[run]?.children ?? [])] as HTMLElement[];
    const list = lists.current[run];
    if (!li || !list) return;
    const middle = y - d.grab - list.getBoundingClientRect().top + li.offsetHeight / 2;
    // Its new place: how many of the other rows have their middle above the lifted row's middle.
    const to = rows.filter((row) => row !== li && row.offsetTop + row.offsetHeight / 2 < middle).length;
    if (to !== rows.indexOf(li)) shift(run, id, to);
  };

  const onUp = (run: number, id: string) => {
    const li = rowEl(run, id);
    drag.current = null;
    if (li) {
      // The row eases down into its slot.
      li.style.transition = stillMotion() ? 'none' : `transform ${DROP_MS}ms ease-out, box-shadow ${DROP_MS}ms ease-out`;
      li.style.transform = '';
    }
    tick();
    setDragging(null);
  };

  return (
    <AdaptiveDialog
      ref={ref}
      historyId="reorder"
      title="Reorder exercises"
      titleSafe
      subtitle="Drag the handle, or use the arrows. Supersets move together."
      onClose={onClose}
      dirty={dirty}
      noKeyboardOnTouch
      fullScreenOnPhone
      footer={
        <>
          <Button variant="secondary" onClick={() => ref.current?.requestClose()} phSafe>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onDone(ids);
              void ref.current?.close();
            }}
            data-ph-capture-attribute-label="workout_reorder_done"
            phSafe
          >
            Done
          </Button>
        </>
      }
    >
      <div className={styles.reorderBody}>
        {runs.map((run, ri) => (
          <div key={run.key} className={styles.reorderRun}>
            {run.section ? <h3 className={styles.reorderSection}>{run.section}</h3> : null}
            <ol
              className={styles.reorderList}
              ref={(el) => {
                lists.current[ri] = el;
              }}
            >
              {order[ri]!.map((item, i) => {
                const name = item.tag ? `${item.tag}: ${item.names.join(', ')}` : item.names.join(', ');
                return (
                  <li
                    key={item.id}
                    data-id={item.id}
                    className={cx(styles.reorderItem, dragging === item.id && styles.reorderDragging)}
                    data-superset={item.kind === 'superset' ? '' : undefined}
                  >
                    <span
                      className={styles.reorderHandle}
                      aria-hidden="true"
                      onPointerDown={onDown(ri, item.id)}
                    >
                      ⠿
                    </span>
                    <span className={styles.reorderNames}>
                      {item.tag ? <span className={styles.reorderTag}>{item.tag}</span> : null}
                      {item.names.map((n, k) => (
                        <span key={k} className={styles.reorderName}>
                          <span className={styles.blockNumber} data-superset={item.kind === 'superset' ? '' : undefined} aria-hidden="true">
                            {badgeOf.get(item.id)?.[k] ?? ''}
                          </span>
                          {n}
                        </span>
                      ))}
                    </span>
                    <button type="button" className={styles.reorderArrow} aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => shift(ri, item.id, i - 1)}>
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      className={styles.reorderArrow}
                      aria-label={`Move ${name} down`}
                      disabled={i === order[ri]!.length - 1}
                      onClick={() => shift(ri, item.id, i + 1)}
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </AdaptiveDialog>
  );
}
