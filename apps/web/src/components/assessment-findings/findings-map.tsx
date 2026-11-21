'use client';

import { useState, type ReactNode } from 'react';
import type { BodyView } from '@caltracker/shared';
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
  allViews = false,
  children,
  className,
}: {
  states: RegionStates;
  onSelect?: (id: BodyRegionId, side: RegionSide) => void;
  selected?: { id: BodyRegionId; side: RegionSide } | null;
  size?: 'small' | 'medium' | 'large';
  startView?: BodyView;
  label?: string;
  /** Both views always (side by side, wrapping when narrow), no switch: for small maps in tight columns (Compare). */
  allViews?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<BodyView>(startView);
  const views: BodyView[] = ['front', 'back'];
  return (
    <div className={cx(styles.mapWrap, className)} data-testid="findings-map">
      {allViews ? null : (
      <div className={styles.viewSwitch} role="group" aria-label="Side of the body">
        {views.map((v) => (
          <button key={v} type="button" className={styles.segment} aria-pressed={view === v} onClick={() => setView(v)}>
            {v === 'front' ? 'Front' : 'Back'}
          </button>
        ))}
      </div>
      )}
      <div className={cx(styles.figures, allViews && styles.figuresAll)}>
        {views.map((v) => (
          <div key={v} className={styles.figure} data-hidden={allViews || view === v ? undefined : ''} data-view={v}>
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
      <BodyMapLegend className={styles.legend ?? ''} />
    </div>
  );
}
