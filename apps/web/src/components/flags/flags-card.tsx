'use client';

import { useId, useState, useTransition } from 'react';
import { flagPlace, openFlagsNewestFirst, type ClientFlag, type ErrorCode, type IsoDate } from '@caltracker/shared';
import { Button, Card, ErrorText } from '@/components/ui';
import { BodyMap } from '@/components/body-map/body-map';
import { flagPins } from '@/components/body-map/state';
import { cx } from '@/components/ui/cx';
import { failureCode } from '@/lib/action-errors';
import { setFlagResolved } from '@/app/(coach)/clients/[clientId]/flags-actions';
import { FlagList } from './flag-list';
import { FlagSheet, type FlagStart } from './flag-sheet';
import styles from './flags.module.css';

/**
 * The "Limitations & injuries" card (boards AS9, AS1): a small front and back body map with the open flags as numbered
 * pins, the flag list (Resolve, a collapsed Resolved), and "+ Flag". Tapping a body part opens "New flag" for it.
 * The same card goes on the Overview and on the Limitations & injuries tab. `id="limitations"` is the anchor the
 * builder's reminder links to.
 */
export function FlagsCard({
  clientId,
  clientName,
  flags,
  readOnly,
  today,
  className,
}: {
  clientId: string;
  clientName: string;
  flags: readonly ClientFlag[];
  readOnly: boolean;
  today: IsoDate;
  className?: string | undefined;
}) {
  const [sheet, setSheet] = useState<{ start: FlagStart } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; undo: ClientFlag | null } | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [, startSave] = useTransition();
  const mapNoteId = useId();
  const open = openFlagsNewestFirst(flags);

  function setResolved(flag: ClientFlag, resolved: boolean) {
    setError(null);
    setBusyId(flag.id);
    startSave(async () => {
      try {
        const outcome = await setFlagResolved(flag.id, resolved, today);
        if (!outcome.ok) return setError(outcome.code);
        setStatus(resolved ? { text: `${flagPlace(flag)} moved to Resolved.`, undo: flag } : { text: `${flagPlace(flag)} is open again.`, undo: null });
      } catch (e) {
        setError(failureCode(e, 'save_offline'));
      } finally {
        setBusyId(null);
      }
    });
  }

  const openSheet = (start: FlagStart) => {
    setStatus(null);
    setSheet({ start });
  };

  return (
    <Card id="limitations" tabIndex={-1} className={cx(styles.card, className)} aria-labelledby="limitations-heading" data-testid="flags-card">
      <div className={styles.cardHead}>
        <h2 id="limitations-heading" className={styles.heading}>
          Limitations &amp; injuries
        </h2>
        {readOnly ? null : (
          <Button variant="quiet" size="compact" onClick={() => openSheet(null)} phSafe data-ph-capture-attribute-label="flag_add">
            + Flag
          </Button>
        )}
      </div>
      <div className={styles.maps}>
        {(['front', 'back'] as const).map((view) => (
          <BodyMap
            key={view}
            view={view}
            size="small"
            label={readOnly ? (view === 'front' ? 'Front of body' : 'Back of body') : view === 'front' ? 'Flag a body part on the front' : 'Flag a body part on the back'}
            pins={flagPins(open, view)}
            describedBy={readOnly ? undefined : mapNoteId}
            {...(readOnly ? {} : { onTap: (hit) => openSheet(hit ? { region: hit.id, side: hit.side } : null) })}
          />
        ))}
      </div>
      {readOnly ? null : (
        <p id={mapNoteId} className={styles.srOnly} data-ph-safe="">
          Opens New flag. Numbers on the map match the list.
        </p>
      )}
      <FlagList flags={flags} readOnly={readOnly} busyId={busyId} onResolve={(f) => setResolved(f, true)} onReopen={(f) => setResolved(f, false)} />
      {error ? <ErrorText code={error} /> : null}
      <div role="status" className={styles.status}>
        {status ? (
          <>
            <span>{status.text}</span>
            {status.undo ? (
              <button type="button" className={styles.undo} onClick={() => setResolved(status.undo!, false)} data-ph-safe="">
                Undo
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      <p className={styles.caption} data-ph-safe="">
        Only you can see this.
      </p>
      {sheet ? (
        <FlagSheet
          clientId={clientId}
          clientName={clientName}
          start={sheet.start}
          today={today}
          onSaved={(place) => setStatus({ text: `${place} flagged.`, undo: null })}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </Card>
  );
}
