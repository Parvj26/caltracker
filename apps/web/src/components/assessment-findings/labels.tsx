import { DIRECTION_LABELS, regionBothName, regionSideLabel, type MarkSide, type MarkStatus, type MuscleId } from '@caltracker/shared';
import styles from './findings.module.css';

// Plain helpers and the status chip, usable from server and client components alike (no 'use client').

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
