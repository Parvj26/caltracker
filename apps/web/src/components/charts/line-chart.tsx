'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import styles from './line-chart.module.css';

export type ChartPoint = {
  /** Position along the bottom, any increasing number (days, say). Equal values are fine. */
  x: number;
  y: number;
  /** What a screen reader and the readout say for this point, e.g. "3 Nov: 116.7 kg (100 kg × 5)". */
  label: string;
};

type Props = {
  points: readonly ChartPoint[];
  /** The chart's name, read out when it takes focus. */
  title: string;
  /** A text alternative that says what the chart shows. Shown under the chart. */
  summary: string;
  /** Labels for the lowest and highest value and for the first and last point, drawn on the axes. */
  yLabel: (y: number) => string;
  xLabel: (x: number) => string;
};

const W = 640;
const H = 260;
const PAD = { top: 16, right: 20, bottom: 36, left: 64 };

/**
 * A small dependency-free line chart drawn as SVG with the design tokens. It is one tab stop: arrow keys move
 * between points (Home and End jump to the ends) and the chosen point is read out below the chart.
 */
export function LineChart({ points, title, summary, yLabel, xLabel }: Props) {
  const id = useId();
  const [active, setActive] = useState(points.length - 1);
  const last = points.length - 1;
  const current = Math.min(active, last);
  if (points.length === 0) return <p className={styles.summary}>{summary}</p>;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
  // Pad the value range so a flat line sits mid-chart and the line never touches the edges.
  const rawMin = Math.min(...ys);
  const rawMax = Math.max(...ys);
  const spread = rawMax - rawMin || Math.max(rawMax * 0.1, 1);
  const yMin = rawMin - spread * 0.15;
  const yMax = rawMax + spread * 0.15;
  const px = (x: number) => (xMax === xMin ? (PAD.left + W - PAD.right) / 2 : PAD.left + ((x - xMin) / (xMax - xMin)) * (W - PAD.left - PAD.right));
  const py = (y: number) => PAD.top + (1 - (y - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? Math.min(current + 1, last)
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? Math.max(current - 1, 0)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  const shown = points[current]!;
  return (
    <div className={styles.wrap}>
      <div
        className={styles.chart}
        role="application"
        tabIndex={0}
        aria-label={`${title}. ${points.length} ${points.length === 1 ? 'point' : 'points'}. Use the left and right arrow keys to move between them.`}
        aria-describedby={`${id}-readout`}
        onKeyDown={onKeyDown}
        data-testid="line-chart"
        // A grey box in session recordings: the line is the client's own numbers.
        data-ph-block=""
      >
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} aria-hidden="true" focusable="false">
          <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className={styles.axis} />
          <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} className={styles.axis} />
          <text x={PAD.left - 8} y={py(rawMax)} className={styles.tick} textAnchor="end" dominantBaseline="middle">{yLabel(rawMax)}</text>
          {rawMax !== rawMin ? (
            <text x={PAD.left - 8} y={py(rawMin)} className={styles.tick} textAnchor="end" dominantBaseline="middle">{yLabel(rawMin)}</text>
          ) : null}
          <text x={px(xMin)} y={H - 12} className={styles.tick} textAnchor={xMax === xMin ? 'middle' : 'start'}>{xLabel(xMin)}</text>
          {xMax !== xMin ? <text x={px(xMax)} y={H - 12} className={styles.tick} textAnchor="end">{xLabel(xMax)}</text> : null}
          <path d={path} className={styles.line} />
          {points.map((p, i) => (
            <circle
              key={i}
              cx={px(p.x)}
              cy={py(p.y)}
              r={i === current ? 7 : 4.5}
              className={i === current ? styles.pointActive : styles.point}
              data-testid="chart-point"
            />
          ))}
        </svg>
      </div>
      <p id={`${id}-readout`} className={styles.readout} aria-live="polite" data-testid="chart-readout">{shown.label}</p>
      <p className={styles.summary}>{summary}</p>
    </div>
  );
}
