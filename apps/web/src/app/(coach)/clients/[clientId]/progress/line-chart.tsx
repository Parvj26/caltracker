'use client';

import { useId, useState } from 'react';
import styles from './progress.module.css';

export type ChartPoint = { date: string; label: string; value: number; text: string };

const W = 300;
const H = 120;
const PAD = { left: 34, right: 8, top: 8, bottom: 20 };

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/**
 * One small line chart: time across, the value up. Hover (or focus a dot with the keyboard) to read the date and
 * value; with nothing hovered it reads the latest point. Drawn with SVG and the app's colour tokens only.
 */
export function LineChart({ title, points, axisFormat }: { title: string; points: ReadonlyArray<ChartPoint>; axisFormat: (v: number) => string }) {
  const readId = useId();
  const [active, setActive] = useState<number | null>(null);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const t0 = dayNumber(first.date);
  const t1 = dayNumber(last.date);
  const lo = Math.min(...points.map((p) => p.value));
  const hi = Math.max(...points.map((p) => p.value));
  const span = hi - lo || 1;
  const yLo = lo - span * 0.1;
  const yHi = hi + span * 0.1;
  const x = (d: string) => PAD.left + ((dayNumber(d) - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - yLo) / (yHi - yLo)) * (H - PAD.top - PAD.bottom);
  const shown = points[active ?? points.length - 1]!;

  function nearest(clientX: number, svg: SVGSVGElement) {
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.date) - sx) < Math.abs(x(points[best]!.date) - sx)) best = i;
    });
    setActive(best);
  }

  return (
    <>
      <p id={readId} className={styles.chartRead} aria-live="polite">
        <strong>{shown.label}</strong> · {shown.text}
      </p>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`${title} chart`}
        aria-describedby={readId}
        onPointerMove={(e) => nearest(e.clientX, e.currentTarget)}
        onPointerLeave={() => setActive(null)}
      >
        <line className={styles.axis} x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} />
        <line className={styles.axis} x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} />
        <text className={styles.axisText} x={PAD.left - 4} y={y(hi) + 3} textAnchor="end">{axisFormat(hi)}</text>
        <text className={styles.axisText} x={PAD.left - 4} y={y(lo) + 3} textAnchor="end">{axisFormat(lo)}</text>
        <text className={styles.axisText} x={PAD.left} y={H - 5}>{first.label}</text>
        <text className={styles.axisText} x={W - PAD.right} y={H - 5} textAnchor="end">{last.label}</text>
        <polyline className={styles.line} points={points.map((p) => `${x(p.date)},${y(p.value)}`).join(' ')} />
        {points.map((p, i) => (
          <circle
            key={p.date}
            className={i === active ? `${styles.dot} ${styles.dotActive}` : styles.dot}
            cx={x(p.date)}
            cy={y(p.value)}
            r={4}
            tabIndex={0}
            role="img"
            aria-label={`${title}: ${p.label}, ${p.text}`}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          />
        ))}
      </svg>
    </>
  );
}
