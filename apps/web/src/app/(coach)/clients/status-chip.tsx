import { Chip } from '@/components/ui';
import type { StatusView } from './status-copy';

// Short results ("Invite sent") stay on one line; long ones (e.g. "trains with another coach") may wrap.
const WRAP_AFTER_CHARS = 32;

/** A send result as a pill chip. */
export function StatusChip({ view }: { view: StatusView }) {
  return (
    <Chip tone={view.tone} wrap={view.text.length > WRAP_AFTER_CHARS}>
      {view.tone === 'amber' ? <span aria-hidden="true">⚠</span> : null}
      {view.text}
    </Chip>
  );
}
