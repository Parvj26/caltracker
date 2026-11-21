'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { FOOT_ARCHES, SLOT_LABELS, checkpointsOf, smartFilter, type AssessmentSlot, type FootArch } from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { AdaptiveDialog, Button, ErrorText, SearchBox, SearchEmpty, TextAreaField, type AdaptiveDialogHandle } from '@/components/ui';
import { failureCode } from '@/lib/action-errors';
import type { ErrorCode } from '@caltracker/shared';
import { useLocalToday } from '@/lib/local-today';
import calendar from '@/components/calendar/calendar.module.css';
import { startAssessment } from './actions';
import type { LibraryTest } from './load';
import { EyeIcon, TestIcon } from './parts';
import styles from './assessments.module.css';

const ARCH_LABELS: Record<FootArch, string> = { flat: 'Flat', normal: 'Normal', high: 'High' };

/**
 * "Start an assessment" (AS2): pick tests from the library (smart search), then "Before the tests" (foot arch L and R,
 * shoes on, and a note), then Start. A retest starts from the Initial's tests ("as Initial") so Compare lines up; the
 * coach can still add or drop one. Templates come in a later step. A bottom sheet on a phone (full screen), a centred
 * dialog on iPad and desktop; the second step is an inline step with Back (never a second pop-up).
 */
export function StartDialog({
  client,
  slot,
  newCycle,
  library,
  defaultKeys,
  onClose,
}: {
  client: { id: string; name: string };
  slot: AssessmentSlot;
  newCycle: boolean;
  library: LibraryTest[];
  defaultKeys: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const today = useLocalToday();
  const dialogRef = useRef<AdaptiveDialogHandle>(null);
  const noteId = useId();
  const [step, setStep] = useState<'pick' | 'before'>('pick');
  const [picked, setPicked] = useState<string[]>(() => defaultKeys.filter((k) => library.some((t) => t.key === k)));
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [archL, setArchL] = useState<FootArch>('normal');
  const [archR, setArchR] = useState<FootArch>('normal');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const label = SLOT_LABELS[slot];
  const asInitial = new Set(defaultKeys);
  const shown = smartFilter(library, query, (t) => t.definition.name);
  const dirty = picked.join() !== defaultKeys.join() || note.trim() !== '' || step === 'before';
  // In library order, so the run goes the way the boards list them.
  const ordered = library.map((t) => t.key).filter((k) => picked.includes(k));

  function toggle(key: string) {
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  }

  async function start() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const outcome = await startAssessment({
        clientId: client.id,
        slot,
        newCycle,
        assessedOn: today,
        footArchLeft: archL,
        footArchRight: archR,
        note,
        testKeys: ordered,
      });
      if (!outcome.ok) {
        setError(outcome.code);
        return;
      }
      await dialogRef.current?.close();
      router.push(`/clients/${client.id}/assessments/${outcome.id}`);
    } catch (e) {
      setError(failureCode(e, 'assessment_start_failed'));
    } finally {
      setPending(false);
    }
  }

  const count = ordered.length;
  return (
    <AdaptiveDialog
      ref={dialogRef}
      historyId="start-assessment"
      title={step === 'pick' ? `${label} · pick tests` : 'Before the tests'}
      titleSafe
      subtitle={step === 'pick' ? client.name : `${label} · ${client.name}`}
      onClose={onClose}
      dirty={dirty}
      discardText="The assessment hasn’t started yet."
      busy={pending}
      size="wide"
      fullScreenOnPhone
      noKeyboardOnTouch
      footer={
        step === 'pick' ? (
          <>
            <Button variant="secondary" onClick={() => dialogRef.current?.requestClose()} phSafe>Cancel</Button>
            <Button onClick={() => count > 0 && setStep('before')} disabled={count === 0} disabledReason="Pick at least 1 test" phSafe>
              {`Start · ${count} ${count === 1 ? 'test' : 'tests'}`}
            </Button>
          </>
        ) : (
          <>
            {error === 'stale_deploy' ? <ReloadButton className={calendar.smallButton} /> : null}
            <Button variant="secondary" onClick={() => setStep('pick')} disabled={pending} phSafe>Back</Button>
            <Button onClick={() => void start()} pending={pending} phSafe>{pending ? 'Starting…' : 'Start tests'}</Button>
          </>
        )
      }
    >
      {step === 'pick' ? (
        <div className={styles.pickWrap}>
          <SearchBox value={query} onChange={setQuery} label="Search tests" />
          {shown.length === 0 ? <SearchEmpty things="tests" query={query} onClear={() => setQuery('')} /> : null}
          <ul className={styles.pickList} aria-label="Tests">
            {shown.map((t) => {
              const on = picked.includes(t.key);
              const id = `pick-${t.key}`;
              const howId = `how-${t.key}`;
              return (
                <li key={t.key} className={styles.pick} data-picked={on ? '' : undefined}>
                  <div className={styles.pickRow}>
                    <label className={styles.pickLabel} htmlFor={id}>
                      <span className={styles.pickThumb}>
                        <TestIcon />
                      </span>
                      <span className={styles.pickText}>
                        <span id={`${id}-name`} className={styles.pickName} data-ph-safe="">{t.definition.name}</span>
                        <span className={styles.pickSummary} data-ph-safe="">
                          {t.definition.summary}
                          {slot !== 'initial' && asInitial.has(t.key) ? ' · as Initial' : ''}
                        </span>
                      </span>
                    </label>
                    <button
                      type="button"
                      className={styles.infoButton}
                      aria-label={`How to do ${t.definition.name}`}
                      aria-expanded={open === t.key}
                      aria-controls={howId}
                      onClick={() => setOpen((o) => (o === t.key ? null : t.key))}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 11v6M12 7.5v.5" />
                      </svg>
                    </button>
                    <label className={styles.checkHit}>
                      <input id={id} type="checkbox" className={styles.pickCheck} checked={on} onChange={() => toggle(t.key)} aria-labelledby={`${id}-name`} />
                    </label>
                  </div>
                  <div id={howId} className={styles.howTo} hidden={open !== t.key}>
                    <ol>
                      {t.definition.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                    {checkpointsOf(t.definition).length > 0 ? (
                      <p className={styles.caption}>Checks: {checkpointsOf(t.definition).map((c) => c.finding ?? c.label).join(', ')}.</p>
                    ) : null}
                    {t.definition.measures.length > 0 ? (
                      <p className={styles.caption}>Measures: {t.definition.measures.map((m) => m.label).join(', ')}.</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className={styles.pickWrap}>
          <p className={styles.watch}>
            <EyeIcon />
            Shoes on. Look at the feet standing.
          </p>
          <fieldset className={styles.archRows} style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className={styles.kicker}>Foot arch</legend>
            <ArchRow side="L" value={archL} onChange={setArchL} />
            <ArchRow side="R" value={archR} onChange={setArchR} />
          </fieldset>
          <TextAreaField id={noteId} label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} placeholder="Add a note" />
          {error ? <ErrorText code={error} /> : null}
        </div>
      )}
    </AdaptiveDialog>
  );
}

function ArchRow({ side, value, onChange }: { side: 'L' | 'R'; value: FootArch; onChange: (v: FootArch) => void }) {
  const word = side === 'L' ? 'Left' : 'Right';
  return (
    <div className={styles.archRow}>
      <span className={styles.sideLabel} aria-hidden="true">{side}</span>
      <div className={styles.segments} role="radiogroup" aria-label={`${word} foot arch`}>
        {FOOT_ARCHES.map((a) => (
          <button key={a} type="button" role="radio" aria-checked={value === a} className={styles.segment} onClick={() => onChange(a)} data-ph-safe="">
            {ARCH_LABELS[a]}
          </button>
        ))}
      </div>
    </div>
  );
}
