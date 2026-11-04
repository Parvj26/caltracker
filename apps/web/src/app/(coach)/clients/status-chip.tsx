import { Chip } from '@/components/ui';
import type { StatusView } from './status-copy';

/** A send result as a chip. Long messages wrap instead of overflowing the row. */
export function StatusChip({ view }: { view: StatusView }) {
  return (
    <Chip tone={view.tone} wrap>
      {view.tone === 'amber' ? <span aria-hidden="true">⚠</span> : null}
      {view.text}
    </Chip>
  );
}
