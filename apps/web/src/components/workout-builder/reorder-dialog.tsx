'use client';

import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Button } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import styles from './builder.module.css';
import { openLayer } from '@/lib/open-layer';

export type ReorderItem = {
  id: string;
  /** "Superset A" for a superset, "Pick one" for a pick-one group, else null. */
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

/**
 * "Reorder exercises": just the names, in order. Drag a row by its handle (mouse, finger or pen) or use ↑ and ↓. A
 * superset moves as one block, and each block stays in its section. Cancel leaves the workout as it was; Done
 * applies the new order.
 */
export function ReorderDialog({ runs, onDone, onClose }: { runs: readonly ReorderRun[]; onDone: (ids: string[]) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [order, setOrder] = useState(() => runs.map((r) => r.items));
  const [dragging, setDragging] = useState<string | null>(null);
  const lists = useRef<(HTMLOListElement | null)[]>([]);

  useEffect(() => {
    const d = ref.current;
    if (d) openLayer(d);
  }, []);

  const shift = (run: number, from: number, to: number) => {
    if (to < 0 || to >= order[run]!.length) return;
    setOrder((o) => o.map((items, r) => (r === run ? move(items, from, to) : items)));
  };

  const onDrag = (run: number, id: string) => (e: PointerEvent<HTMLSpanElement>) => {
    if (dragging !== id) return;
    const rows = [...(lists.current[run]?.children ?? [])];
    const to = rows.findIndex((row) => {
      const r = row.getBoundingClientRect();
      return e.clientY >= r.top && e.clientY < r.bottom;
    });
    const from = order[run]!.findIndex((x) => x.id === id);
    if (to >= 0 && to !== from) shift(run, from, to);
  };

  return (
    <dialog
      ref={ref}
      className={styles.reorderDialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className={styles.reorderHead}>
        <h2 id={titleId} className={styles.dialogTitle}>Reorder exercises</h2>
        <p className={styles.caption}>Drag the handle, or use the arrows. Supersets move together.</p>
      </div>
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
                    className={cx(styles.reorderItem, dragging === item.id && styles.reorderDragging)}
                    data-superset={item.tag?.startsWith('Superset') ? '' : undefined}
                  >
                    <span
                      className={styles.reorderHandle}
                      aria-hidden="true"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setDragging(item.id);
                      }}
                      onPointerMove={onDrag(ri, item.id)}
                      onPointerUp={() => setDragging(null)}
                      onPointerCancel={() => setDragging(null)}
                    >
                      ⠿
                    </span>
                    <span className={styles.reorderNames}>
                      {item.tag ? <span className={styles.reorderTag}>{item.tag}</span> : null}
                      {item.names.map((n, k) => (
                        <span key={k} className={styles.reorderName}>{n}</span>
                      ))}
                    </span>
                    <button type="button" className={styles.reorderArrow} aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => shift(ri, i, i - 1)}>
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      className={styles.reorderArrow}
                      aria-label={`Move ${name} down`}
                      disabled={i === order[ri]!.length - 1}
                      onClick={() => shift(ri, i, i + 1)}
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
      <div className={styles.reorderActions}>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            onDone(order.flatMap((items) => items.map((x) => x.id)));
            onClose();
          }}
          data-ph-capture-attribute-label="workout_reorder_done"
        >
          Done
        </Button>
      </div>
    </dialog>
  );
}
