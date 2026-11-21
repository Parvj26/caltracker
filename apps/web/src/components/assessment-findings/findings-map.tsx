'use client';

import { useState, type ReactNode } from 'react';
import { DIRECTION_LABELS, regionBothName, regionSideLabel, type BodyView, type MarkSide, type MarkStatus, type MuscleId } from '@caltracker/shared';
import { BodyMap, BodyMapLegend } from '@/components/body-map/body-map';
import type { RegionSide, RegionStates } from '@/components/body-map/state';
import type { BodyRegionId } from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import styles from './findings.module.css';

/**
 * The findings body map (boards AS4 / AS6): front and back with the coach's confirmed marks (solid red = possibly
 * overactive, blue hatching = possibly underactive, green outline with a tick = normal, grey = not checked) and the
 * key. In a narrow box one view shows behind a Front / Back switch; from about 440 px wide both show side by side.
 * Pass `onSelect` to make every muscle tappable (the Findings screen's picker); `children` sits over the figures
 * (that picker).
 */
export function FindingsMap({
  states,
  onSelect,
  selected = null,
  size = 'medium',
  startView = 'back',
  label = 'Findings',
  children,
  className,
}: {
  states: RegionStates;
  onSelect?: (id: BodyRegionId, side: RegionSide) => void;
  selected?: { id: BodyRegionId; side: RegionSide } | null;
  size?: 'small' | 'medium' | 'large';
  startView?: BodyView;
  label?: string;
  children?: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<BodyView>(startView);
  const views: BodyView[] = ['front', 'back'];
  return (
    <div className={cx(styles.mapWrap, className)} data-testid="findings-map">
      <div className={styles.viewSwitch} role="group" aria-label="Side of the body">
        {views.map((v) => (
          <button key={v} type="button" className={styles.segment} aria-pressed={view === v} onClick={() => setView(v)}>
            {v === 'front' ? 'Front' : 'Back'}
          </button>
        ))}
      </div>
      <div className={styles.figures}>
        {views.map((v) => (
          <div key={v} className={styles.figure} data-hidden={view === v ? undefined : ''} data-view={v}>
            <BodyMap
              view={v}
              label={`${label}: ${v === 'front' ? 'front' : 'back'} of body`}
              states={states}
              size={size}
              {...(onSelect ? { onSelect } : {})}
              selected={selected}
            />
          </div>
        ))}
        {children}
      </div>
      <BodyMapLegend className={styles.legend} />
    </div>
  );
}

/** "↑ Over" (solid red swatch) / "↓ Under" (blue hatching) / "✓ Normal": the status chip in lists, never colour alone. */
export function MarkChip({ status }: { status: MarkStatus }) {
  const text = status === 'normal' ? 'Normal' : `${status === 'over' ? '↑' : '↓'} ${DIRECTION_LABELS[status].short}`;
  return (
    <span className={styles.markChip} data-status={status}>
      <span className={styles.swatch} aria-hidden="true" />
      {text}
    </span>
  );
}

/** "L R", "L", or nothing for a one-piece region. */
export function sidesText(sides: readonly MarkSide[]): string {
  return sides.filter((s) => s !== 'none').join(' ');
}

/** "Glute medius · L R" / "Abs". */
export function muscleSidesLabel(muscleId: MuscleId, sides: readonly MarkSide[]): string {
  const s = sidesText(sides);
  if (!s) return regionSideLabel(muscleId, 'none');
  return `${regionSideLabel(muscleId, 'none')} · ${s}`;
}

/** Screen-reader words for a muscle and its sides ("Both glute medius", "Left calf"). */
export function muscleSidesName(muscleId: MuscleId, sides: readonly MarkSide[]): string {
  if (sides.length === 2) return regionBothName(muscleId);
  return regionSideLabel(muscleId, sides[0] ?? 'none');
}
