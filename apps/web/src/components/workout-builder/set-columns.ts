import { TARGET_FIELDS } from '@caltracker/shared';
import type { TrackingType } from '@caltracker/shared';

/** One column of an exercise's set rows. The captions match the start of each input's accessible name. */
export type SetColumn = { key: 'label' | 'type' | 'reps' | 'weight' | 'duration' | 'distance' | 'rest' | 'note' | 'actions'; caption: string; width: string };

/**
 * The columns of an exercise's set rows, in order, so the caption row above the sets and every row line up (one
 * shared grid template). The tracking type decides which targets appear: "Time" or "Distance" replace reps and
 * weight. Rest is kept as a column even when this exercise has none (in a superset only the last one rests), so a
 * drop set's "To failure" box still has its place.
 */
export function setColumns(trackingType: TrackingType, showRest: boolean): SetColumn[] {
  const fields = TARGET_FIELDS[trackingType];
  const cols: SetColumn[] = [
    { key: 'label', caption: '', width: '24px' },
    { key: 'type', caption: 'Type', width: '7rem' },
  ];
  if (fields.includes('reps')) cols.push({ key: 'reps', caption: 'Reps', width: '15rem' });
  if (fields.includes('weight')) cols.push({ key: 'weight', caption: 'Weight', width: '8rem' });
  if (fields.includes('duration')) cols.push({ key: 'duration', caption: 'Time', width: '5rem' });
  if (fields.includes('distance')) cols.push({ key: 'distance', caption: 'Distance', width: '8rem' });
  cols.push(
    { key: 'rest', caption: showRest ? 'Rest' : '', width: '7rem' },
    { key: 'note', caption: 'Note', width: 'minmax(8rem, 1fr)' },
    { key: 'actions', caption: '', width: 'auto' },
  );
  return cols;
}

export const gridTemplate = (cols: readonly SetColumn[]) => cols.map((c) => c.width).join(' ');
