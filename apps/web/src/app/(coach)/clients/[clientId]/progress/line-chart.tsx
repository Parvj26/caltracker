'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import styles from './progress.module.css';

export type ChartPoint = { date: string; label: string; value: number; text: string };

const W = 300;
const H = 110;
const PAD = 6;

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/**
 * One small line chart: time across, the value up. Hover to read the date and value, or Tab to the chart and use
 * the arrow keys (Home and End jump to the ends); with nothing chosen it reads the latest point. Screen readers hear
 * only the point chosen with the keyboard, not every pointer move. The axis labels are plain HTML so they keep the
 * page's text size however wide the chart is drawn.
 */
export function LineChart({ title, points, axisFormat }: { title: string; points: ReadonlyArray<ChartPoint>; axisFormat: (v: number) => string }) {
  const readId = useId();
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const t0 = dayNumber(first.date);
  const t1 = dayNumber(last.date);
  const lo = Math.min(...points.map((p) => p.value));
  const hi = Math.max(...points.map((p) => p.value));
  const span = hi - lo || 1;
  const yLo = lo - span * 0.1;
  const yHi = hi + span * 0.1;
  const x = (d: string) => PAD + ((dayNumber(d) - t0) / (t1 - t0 || 1)) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - yLo) / (yHi - yLo)) * (H - 2 * PAD);
  const shown = points[focused ?? active ?? points.length - 1]!;

  function nearest(clientX: number, svg: SVGSVGElement) {
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.date) - sx) < Math.abs(x(points[best]!.date) - sx)) best = i;
    });
    setActive(best);
  }

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    const at = focused ?? points.length - 1;
    const next =
      e.key === 'ArrowRight' ? Math.min(at + 1, points.length - 1)
      : e.key === 'ArrowLeft' ? Math.max(at - 1, 0)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? points.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    setFocused(next);
  }

  return (
    <>
      <p className={styles.chartRead}>
        <strong>{shown.label}</strong> · {shown.text}
      </p>
      {/* Heard by screen readers only when the keyboard moves between points. */}
      <p id={readId} className={styles.srOnly} aria-live="polite">{focused === null ? '' : `${shown.label}, ${shown.text}`}</p>
      {/* data-ph-block: a grey box in session recordings (the line is the client's own numbers). */}
      <div className={styles.plot} data-ph-block="">
        <div className={styles.yLabels} aria-hidden="true">
          <span>{axisFormat(hi)}</span>
          <span>{axisFormat(lo)}</span>
        </div>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          tabIndex={0}
          aria-label={`${title} chart, ${points.length} points. Use the left and right arrow keys to read them.`}
          aria-describedby={readId}
          onPointerMove={(e) => nearest(e.clientX, e.currentTarget)}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setFocused((f) => f ?? points.length - 1)}
          onBlur={() => setFocused(null)}
          onKeyDown={onKey}
        >
          <line className={styles.axis} x1={PAD} x2={PAD} y1={PAD} y2={H - PAD} />
          <line className={styles.axis} x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} />
          <polyline className={styles.line} points={points.map((p) => `${x(p.date)},${y(p.value)}`).join(' ')} />
          {points.map((p, i) => (
            <circle
              key={p.date}
              className={i === (focused ?? active) ? `${styles.dot} ${styles.dotActive}` : styles.dot}
              cx={x(p.date)}
              cy={y(p.value)}
              r={4}
              aria-hidden="true"
            />
          ))}
        </svg>
        <div className={styles.xLabels} aria-hidden="true">
          <span>{first.label}</span>
          <span>{last.label}</span>
        </div>
      </div>
    </>
  );
}
