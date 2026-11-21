'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  FIGURE_AREAS,
  FIGURE_HEAD,
  FIGURE_HEIGHT,
  FIGURE_MUSCLES,
  FIGURE_SILHOUETTE,
  FIGURE_WIDTH,
  isBodyRegionId,
  isMirrored,
  pathCentre,
  viewerLeftSide,
  type BodyAreaId,
  type BodyRegionId,
  type BodySide,
  type BodyView,
  type MuscleId,
} from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import { mapTargets, paintFor, regionKey, regionLabel, stateOf, type MapPin, type MapTarget, type RegionSide, type RegionStates } from './state';
import styles from './body-map.module.css';

const MIRROR = `translate(${FIGURE_WIDTH},0) scale(-1,1)`;
/** The figure's width on screen per size (keep in step with body-map.module.css). */
const SIZE_PX = { small: 110, medium: 170, large: 260 } as const;

export type BodyMapProps = {
  view: BodyView;
  /** Names the figure for screen readers ("Front of body"). */
  label: string;
  /** Per region and side: over / under / normal (unmarked when left out). */
  states?: RegionStates;
  /** Numbered markers (flags), with an amber dashed ring as the second cue. Use flagPins() to place them. */
  pins?: readonly MapPin[];
  /** Outlined in ink: the region being picked. 'both' outlines both sides. */
  selected?: { id: BodyRegionId; side: RegionSide | 'both' | 'centre' } | null;
  /**
   * Pick mode: the figure is a radio group of body parts (tap one, or arrow keys). The side is the client's own.
   * Small regions are under the 44 px tap size, so a picker also offers a list (the New flag sheet's Body part).
   */
  onSelect?: (id: BodyRegionId, side: RegionSide) => void;
  /**
   * Tap mode: the whole figure is one button (named by `label`). A tap reports the body part under the finger; the
   * keyboard (Enter / Space) reports null. For small maps that open a picker (the Overview card).
   */
  onTap?: (hit: { id: BodyRegionId; side: RegionSide } | null) => void;
  /** Also lets joints (knee, ankle…) be tapped; for flags, not findings. */
  areas?: boolean;
  /** The L / R letters under the feet. */
  showSides?: boolean;
  /** Width on screen: small (cards, ~110), medium (~170), large (pickers, up to 260 and full width on a phone). */
  size?: 'small' | 'medium' | 'large';
  /** Extra words linked to each region's name (e.g. how pins are numbered). */
  describedBy?: string | undefined;
  className?: string | undefined;
};

/** "knee.L" / "abs" (a shape's data-region) back to a region and side. */
export function parseRegionKey(key: string): { id: BodyRegionId; side: RegionSide } | null {
  const [id, side] = key.split('.');
  if (!id || !isBodyRegionId(id)) return null;
  return { id, side: side === 'L' || side === 'R' ? side : 'none' };
}

/**
 * The body map: a front or back figure with muscle groups split left and right (board AS4 / AS9). Regions are keyed by
 * the shared muscle catalogue; states, flag pins and the selection come in as props. Three modes: a picture (default),
 * pick (onSelect: every region a radio with a name, "Left glute medius, possibly underactive"; the figure is one tab
 * stop and the arrow keys move the choice top to bottom), or tap (onTap: the whole figure is one button). It scales
 * with its box, so a phone can pinch-zoom it.
 */
export function BodyMap({ view, label, states, pins = [], selected = null, onSelect, onTap, areas = false, showSides = true, size = 'medium', describedBy, className }: BodyMapProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const hatchId = `bm${uid}h`;
  const clipId = `bm${uid}c`;
  const interactive = onSelect !== undefined;
  const tappable = !interactive && onTap !== undefined;
  const targets = interactive ? mapTargets(view, areas) : [];
  const selectedIndex = selected ? targets.findIndex((t) => t.id === selected.id && (t.side === 'none' || selected.side === t.side || selected.side === 'both' || selected.side === 'centre')) : -1;
  const [focused, setActive] = useState<number | null>(null);
  const active = focused ?? (selectedIndex >= 0 ? selectedIndex : 0);
  const svgRef = useRef<SVGSVGElement>(null);
  const left = viewerLeftSide(view);
  const shapes = FIGURE_MUSCLES[view];
  // Pins keep the same size on screen whatever the figure's size (drawing units per screen pixel).
  // Never below 1, so the number stays at least 12 px for the text-size rule.
  const k = Math.max(1, FIGURE_WIDTH / SIZE_PX[size]);

  const indexOf = (id: string, side: RegionSide) => targets.findIndex((t) => t.id === id && t.side === side);

  /** Radio-group keys: the arrows move the choice (and focus) to the next body part. */
  function focusAt(i: number) {
    const n = targets.length;
    const next = ((i % n) + n) % n;
    setActive(next);
    svgRef.current?.querySelector<SVGElement>(`[data-target="${next}"]`)?.focus();
    const t = targets[next]!;
    onSelect?.(t.id, t.side);
  }

  function onKey(e: KeyboardEvent<SVGElement>, t: MapTarget, i: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(t.id, t.side);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      focusAt(i + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      focusAt(i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(targets.length - 1);
    }
  }

  /** The props that make a shape a button (only on the shape that carries the target; its mirror twin just clicks). */
  function buttonProps(id: BodyRegionId, side: RegionSide, primary: boolean) {
    if (!interactive) return {};
    const i = indexOf(id, side);
    if (i < 0) return {};
    const t = targets[i]!;
    const click = { onClick: () => onSelect?.(t.id, t.side) };
    if (!primary) return { ...click, 'aria-hidden': true };
    const isSel = selected !== null && selected.id === id && (selected.side === side || selected.side === 'both' || selected.side === 'centre' || side === 'none');
    return {
      ...click,
      role: 'radio',
      tabIndex: i === active ? 0 : -1,
      'data-target': i,
      'aria-label': regionLabel(id, side, stateOf(states, id, side)),
      'aria-checked': isSel,
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      onKeyDown: (e: KeyboardEvent<SVGElement>) => onKey(e, t, i),
      onFocus: () => setActive(i),
    };
  }

  const fillOf = (s: ReturnType<typeof paintFor>['fill']) =>
    s === 'over' ? 'var(--ct-map-over)' : s === 'under' ? `url(#${hatchId})` : s === 'normal' ? 'var(--ct-map-normal)' : 'var(--ct-map-region)';

  /** One half's muscles, for the client's `side` (drawn mirrored when it is the viewer's right). */
  function half(side: BodySide) {
    return Object.entries(shapes).map(([id, d]) => {
      const m = id as MuscleId;
      const oneSided = m === 'abs';
      const regionSide: RegionSide = oneSided ? 'none' : side;
      const primary = !oneSided || side === left;
      return (
        <path
          key={id}
          d={d}
          fill={fillOf(paintFor(stateOf(states, m, regionSide)).fill)}
          className={cx(styles.region, (interactive || tappable) && styles.hit)}
          data-region={regionKey(m, regionSide)}
          data-state={stateOf(states, m, regionSide)}
          {...buttonProps(m, regionSide, primary)}
        />
      );
    });
  }

  // Normal regions: a dark green outline and a tick on top (clipped with the rest).
  const normals = Object.entries(shapes).flatMap(([id, d]) =>
    (['L', 'R'] as const).flatMap((side) => {
      const m = id as MuscleId;
      if (m === 'abs' && side !== left) return [];
      const rs: RegionSide = m === 'abs' ? 'none' : side;
      if (!paintFor(stateOf(states, m, rs)).outline) return [];
      const mirror = m !== 'abs' && isMirrored(view, side);
      const c = pathCentre(d);
      const cx0 = m === 'abs' ? FIGURE_WIDTH / 2 : mirror ? FIGURE_WIDTH - c.x : c.x;
      return [
        <g key={`${id}.${side}`} className={styles.normal} aria-hidden="true">
          <path d={d} transform={mirror ? MIRROR : undefined} />
          {m === 'abs' ? <path d={d} transform={MIRROR} /> : null}
          <path d={`M${cx0 - 3.2},${c.y} l2.2,2.4 l4.4,-5`} className={styles.tick} />
        </g>,
      ];
    }),
  );

  const outline = (id: BodyRegionId, side: BodySide) => {
    const d = shapes[id as MuscleId];
    if (d) return <path key={`sel-${id}-${side}`} d={d} className={styles.selected} transform={isMirrored(view, side) ? MIRROR : undefined} aria-hidden="true" />;
    const a = FIGURE_AREAS[id as BodyAreaId];
    if (!a) return null;
    const x = isMirrored(view, side) ? FIGURE_WIDTH - a.x : a.x;
    return <circle key={`sel-${id}-${side}`} cx={x} cy={a.y} r={a.r} className={styles.selected} aria-hidden="true" />;
  };
  const selectedOutlines = selected
    ? selected.side === 'L' || selected.side === 'R'
      ? [outline(selected.id, selected.side)]
      : [outline(selected.id, 'L'), outline(selected.id, 'R')]
    : [];

  const svg = (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${FIGURE_WIDTH} ${FIGURE_HEIGHT}`}
      className={cx(styles.map, styles[size], (interactive || tappable) && styles.interactive, !tappable && className)}
      role={interactive ? 'radiogroup' : tappable ? undefined : 'img'}
      aria-label={tappable ? undefined : label}
      aria-hidden={tappable ? true : undefined}
      data-view={view}
    >
      <defs>
        <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="var(--ct-map-under-bg)" />
          <rect width="2.6" height="5" fill="var(--ct-magenta)" />
        </pattern>
        <clipPath id={clipId}>
          <path d={FIGURE_SILHOUETTE} />
          <path d={FIGURE_SILHOUETTE} transform={MIRROR} />
        </clipPath>
      </defs>
      <g aria-hidden="true">
        <ellipse {...FIGURE_HEAD} className={styles.head} />
        <path d={FIGURE_SILHOUETTE} className={styles.edge} />
        <path d={FIGURE_SILHOUETTE} className={styles.edge} transform={MIRROR} />
        <path d={FIGURE_SILHOUETTE} className={styles.skin} />
        <path d={FIGURE_SILHOUETTE} className={styles.skin} transform={MIRROR} />
      </g>
      <g clipPath={`url(#${clipId})`}>
        <g>{half(left)}</g>
        <g transform={MIRROR}>{half(left === 'L' ? 'R' : 'L')}</g>
        {normals}
      </g>
      {areas || tappable
        ? (['L', 'R'] as const).flatMap((side) =>
            Object.entries(FIGURE_AREAS).map(([id, a]) => (
              <circle
                key={`${id}.${side}`}
                cx={isMirrored(view, side) ? FIGURE_WIDTH - a.x : a.x}
                cy={a.y}
                r={a.r}
                className={cx(styles.area, (interactive || tappable) && styles.hit)}
                data-region={regionKey(id, side)}
                {...buttonProps(id as BodyAreaId, side, true)}
              />
            )),
          )
        : null}
      {selectedOutlines}
      <g aria-hidden="true" className={styles.pins}>
        {pins.map((p) => (
          <circle key={`ring-${p.key}`} cx={p.x} cy={p.y} r={15 * k} strokeWidth={1.6 * k} strokeDasharray={`${3 * k} ${2 * k}`} className={styles.pinRing} />
        ))}
        {pins.map((p) => (
          <g key={`pin-${p.key}`} data-pin={p.label}>
            <circle cx={p.x} cy={p.y} r={9 * k} strokeWidth={2 * k} className={styles.pinDot} />
            <text x={p.x} y={p.y + 4.2 * k} textAnchor="middle" fontSize={12 * k} className={styles.pinText}>
              {p.label}
            </text>
          </g>
        ))}
      </g>
      {showSides ? (
        <g aria-hidden="true" className={styles.sides}>
          <text x="20" y="412">{left}</text>
          <text x="170" y="412">{left === 'L' ? 'R' : 'L'}</text>
        </g>
      ) : null}
    </svg>
  );
  if (!tappable) return svg;
  // Tap mode: a clear button over the figure (so the drawing's letters and pin numbers are not part of its name). A
  // pointer tap looks up the body part under the finger; the keyboard (detail 0) names none.
  return (
    <div className={cx(styles.tapWrap, className)} data-view={view}>
      {svg}
      <button
        type="button"
        className={styles.tapButton}
        aria-label={label}
        aria-describedby={describedBy}
        onClick={(e) => {
          const under = e.detail === 0 ? [] : document.elementsFromPoint(e.clientX, e.clientY);
          const key = under.find((el) => svgRef.current?.contains(el) && el.hasAttribute('data-region'))?.getAttribute('data-region');
          onTap?.(key ? parseRegionKey(key) : null);
        }}
      />
    </div>
  );
}

/** The map's key: the three marked states, each with its swatch (same cues as the map). */
export function BodyMapLegend({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <ul className={cx(styles.legend, className)} aria-label="Key">
      <li>
        <svg viewBox="0 0 14 14" aria-hidden="true"><rect x="0.5" y="0.5" width="13" height="13" rx="3.5" fill="var(--ct-map-over)" /></svg>
        Possibly overactive
      </li>
      <li>
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <defs>
            <pattern id={`lg${uid}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" fill="var(--ct-map-under-bg)" />
              <rect width="2.6" height="5" fill="var(--ct-magenta)" />
            </pattern>
          </defs>
          <rect x="0.5" y="0.5" width="13" height="13" rx="3.5" fill={`url(#lg${uid})`} />
        </svg>
        Possibly underactive
      </li>
      <li>
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <rect x="1" y="1" width="12" height="12" rx="3.5" fill="var(--ct-map-normal)" stroke="var(--ct-map-normal-line)" strokeWidth="1.6" />
          <path d="M4 7.2l2 2 4-4.4" fill="none" stroke="var(--ct-map-normal-line)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Normal
      </li>
    </ul>
  );
}
