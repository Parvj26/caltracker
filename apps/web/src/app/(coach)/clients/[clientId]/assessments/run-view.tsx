'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SLOT_LABELS,
  followUpShown,
  type CheckpointDef,
  type CheckpointResult,
  type ErrorCode,
  type MeasureDef,
  type Severity,
  type Side,
  type TestDefinition,
  type TestEntry,
  type TestStatus,
} from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { Button, ErrorText, PhoneActionBar, TextAreaField, TextField } from '@/components/ui';
import { failureCode } from '@/lib/action-errors';
import calendar from '@/components/calendar/calendar.module.css';
import { finishAssessment, saveAssessmentTest } from './actions';
import type { AssessmentDetail } from './load';
import { EyeIcon, TestIcon } from './parts';
import styles from './assessments.module.css';

const SIDE_WORD: Record<Side, string> = { L: 'left', R: 'right', none: '' };
const UNIT: Record<MeasureDef['unit'], string> = { cm: 'cm', deg: '°', s: 's' };
const AUTOSAVE_MS = 700;

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; code: ErrorCode };

/** Where to open: ?test=N when given, else the first test not yet looked at (resume), else the last. */
export function startIndex(tests: AssessmentDetail['tests'], fromUrl: number | null): number {
  if (fromUrl !== null && Number.isInteger(fromUrl) && fromUrl >= 1 && fromUrl <= tests.length) return fromUrl - 1;
  const pending = tests.findIndex((t) => t.entry.status === 'pending');
  return pending === -1 ? Math.max(0, tests.length - 1) : pending;
}

const severityOf = (results: readonly CheckpointResult[], id: string, side: Side): Severity =>
  results.find((r) => r.checkpointId === id && r.side === side)?.severity ?? 'normal';

/**
 * Running an assessment (AS3): one test per screen. How-to, one "what to watch" line per view, the checkpoints by
 * body region (Front / Side switch on a phone; every view at once on iPad and desktop), Normal / Slight / Severe per
 * side with Normal pre-selected (tap Slight or Severe again to go back to Normal), measurements, the heel-lift
 * follow-up, "Type done", discomfort L / R, Stop test, a note. Every change is saved as a draft a moment later, so
 * the coach can close it and pick it up again where they left off.
 */
export function RunView({ client, assessment, testFromUrl }: { client: { id: string; name: string }; assessment: AssessmentDetail; testFromUrl: number | null }) {
  const router = useRouter();
  const tests = assessment.tests;
  const [index, setIndex] = useState(() => startIndex(tests, testFromUrl));
  const [entries, setEntriesState] = useState<Record<string, TestEntry>>(() => Object.fromEntries(tests.map((t) => [t.id, t.entry])));
  // The newest entries for saves that run after a render (autosave timer, the save queue).
  const entriesRef = useRef(entries);
  const setEntries = useCallback((update: (all: Record<string, TestEntry>) => Record<string, TestEntry>) => {
    const next = update(entriesRef.current);
    entriesRef.current = next;
    setEntriesState(next);
  }, []);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [moving, setMoving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyTest = useRef<string | null>(null);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));

  const test = tests[index];

  const persist = useCallback((testId: string, status?: TestStatus): Promise<boolean> => {
    chain.current = chain.current.then(async () => {
      const entry = entriesRef.current[testId];
      if (!entry) return false;
      const toSave = status ? { ...entry, status } : entry;
      setSave({ kind: 'saving' });
      try {
        const outcome = await saveAssessmentTest(testId, toSave);
        if (!outcome.ok) {
          setSave({ kind: 'error', code: outcome.code });
          return false;
        }
        if (status) setEntries((all) => ({ ...all, [testId]: { ...(all[testId] ?? toSave), status } }));
        setSave({ kind: 'saved' });
        return true;
      } catch (e) {
        setSave({ kind: 'error', code: failureCode(e, 'assessment_save_failed') });
        return false;
      }
    });
    return chain.current;
  }, [setEntries]);

  /** Saves the change a moment later (autosave), and any change still waiting right away when asked. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const id = dirtyTest.current;
    dirtyTest.current = null;
    return id ? persist(id) : chain.current;
  }, [persist]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function change(testId: string, update: (e: TestEntry) => TestEntry) {
    setEntries((all) => {
      const current = all[testId];
      return current ? { ...all, [testId]: update(current) } : all;
    });
    if (dirtyTest.current && dirtyTest.current !== testId) void flush();
    dirtyTest.current = testId;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  function go(next: number) {
    setIndex(next);
    const url = new URL(window.location.href);
    url.searchParams.set('test', String(next + 1));
    window.history.replaceState(window.history.state, '', url);
    window.scrollTo({ top: 0 });
  }

  async function leave(status: TestStatus) {
    if (!test || moving) return;
    setMoving(true);
    try {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      dirtyTest.current = null;
      const ok = await persist(test.id, status);
      if (!ok) return;
      if (index < tests.length - 1) {
        go(index + 1);
        return;
      }
      const outcome = await finishAssessment(assessment.id);
      if (!outcome.ok) {
        setSave({ kind: 'error', code: outcome.code });
        return;
      }
      // The same address shows the summary now that it is done. A full load (not the client router, which may still
      // hold the draft screen for this address) so the summary always comes from the server.
      window.location.replace(`/clients/${client.id}/assessments/${assessment.id}`);
      return;
    } catch (e) {
      setSave({ kind: 'error', code: failureCode(e, 'assessment_finish_failed') });
    } finally {
      setMoving(false);
    }
  }

  async function close() {
    await flush();
    router.push(`/clients/${client.id}/limitations`);
  }

  if (!test) return <div className={styles.run} aria-busy="true" />;
  const entry = entries[test.id] ?? test.entry;
  const def = test.definition;
  const last = index === tests.length - 1;
  const status = save.kind === 'saving' ? 'Saving…' : save.kind === 'saved' ? 'Draft saved' : null;

  return (
    <div className={styles.run} data-testid="assessment-run">
      <header className={styles.runHead}>
        <div>
          <p className={styles.caption}>
            <span data-ph-safe="">{client.name}</span> · {SLOT_LABELS[assessment.slot]} · test {index + 1} of {tests.length}
          </p>
          <h1 className={styles.runTitle} data-ph-safe="">{def.name}</h1>
        </div>
        <button type="button" className={styles.close} aria-label="Close (your draft is kept)" onClick={() => void close()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <ol className={styles.progress} aria-label={`Test ${index + 1} of ${tests.length}`}>
        {tests.map((t, i) => (
          <li key={t.id} data-state={i === index ? 'current' : (entries[t.id]?.status ?? 'pending') !== 'pending' ? 'done' : 'todo'} />
        ))}
      </ol>

      <TestScreen key={test.id} definition={def} entry={entry} onChange={(u) => change(test.id, u)} onStop={() => void leave('stopped')} busy={moving} />

      {save.kind === 'error' ? (
        <div className={styles.saveError}>
          <ErrorText code={save.code} />
          {save.code === 'stale_deploy' ? <ReloadButton className={calendar.smallButton} /> : null}
        </div>
      ) : null}
      <PhoneActionBar status={status ? <span className={styles.statusOk}>{status}</span> : undefined} label="Test actions">
        <Button variant="secondary" onClick={() => void leave('skipped')} disabled={moving} phSafe>Skip test</Button>
        <Button onClick={() => void leave('done')} pending={moving} phSafe>{last ? 'Finish' : 'Next test'}</Button>
      </PhoneActionBar>
    </div>
  );
}

function TestScreen({
  definition: def,
  entry,
  onChange,
  onStop,
  busy,
}: {
  definition: TestDefinition;
  entry: TestEntry;
  onChange: (u: (e: TestEntry) => TestEntry) => void;
  /** Stop test: ends this test and keeps what was entered. */
  onStop: () => void;
  busy: boolean;
}) {
  const [viewId, setViewId] = useState(def.views[0]?.id ?? 'front');
  const watchAll = def.views.map((v) => v.watch).join(' · ');

  const rate = (checkpointId: string, side: Side, severity: Severity) =>
    onChange((e) => {
      const results = e.results.filter((r) => !(r.checkpointId === checkpointId && r.side === side));
      if (severity !== 'normal') results.push({ checkpointId, side, severity });
      // A follow-up whose checkpoint went back to Normal is no longer asked: drop its answer.
      const followUps = Object.fromEntries(Object.entries(e.followUps).filter(([id]) => followUpShown(def, id, results)));
      return { ...e, results, followUps };
    });

  return (
    <div className={styles.runBody}>
      <div className={styles.runSide}>
        <div className={styles.howToCard}>
          <span className={styles.photo}>
            <TestIcon size={26} />
          </span>
          <ol data-ph-safe="">
            {def.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
        <p className={`${styles.watch} ${def.views.length > 1 ? styles.watchWide : ''}`} data-ph-safe="">
          <EyeIcon />
          {watchAll}
        </p>
      </div>

      <div className={styles.runMain}>
        {def.views.length > 1 ? (
          <div className={`${styles.segments} ${styles.viewSwitch}`} data-fit="" role="radiogroup" aria-label="View">
            {def.views.map((v) => (
              <button key={v.id} type="button" role="radio" aria-checked={viewId === v.id} className={styles.segment} onClick={() => setViewId(v.id)} data-ph-safe="">
                {v.label}
              </button>
            ))}
          </div>
        ) : null}
        {def.typeDone ? (
          <TextField
            label={def.typeDone.label}
            value={entry.typeDone}
            placeholder={def.typeDone.placeholder}
            maxLength={120}
            onChange={(e) => {
              const typeDone = e.target.value;
              onChange((x) => ({ ...x, typeDone }));
            }}
          />
        ) : null}
        <div className={styles.views} data-count={def.views.length}>
          {def.views.map((v) => (
            <section key={v.id} className={styles.view} data-hidden={def.views.length > 1 && v.id !== viewId ? '' : undefined} aria-label={`${v.label} view`}>
              {def.views.length > 1 ? (
                <p className={`${styles.watch} ${styles.viewWatch}`} data-ph-safe="">
                  <EyeIcon />
                  {v.watch}
                </p>
              ) : null}
              {v.groups.map((g) => (
                <div key={g.label} className={styles.group}>
                  <p className={`${styles.kicker} ${styles.groupLabel}`} data-ph-safe="">{g.label}</p>
                  {g.checkpoints.map((c) => (
                    <div key={c.id} className={styles.checkpoint}>
                      <CheckpointRow checkpoint={c} results={entry.results} onRate={rate} />
                      {def.followUps
                        .filter((f) => f.after === c.id && followUpShown(def, f.id, entry.results))
                        .map((f) => (
                          <div key={f.id} className={styles.followUp}>
                            <p className={styles.followTitle} data-ph-safe="">{f.label}</p>
                            <p className={styles.caption} data-ph-safe="">{f.prompt}</p>
                            <div className={styles.segments} data-fit="" role="group" aria-label={f.label}>
                              {f.options.map((o) => (
                                <button
                                  key={o.value}
                                  type="button"
                                  className={styles.segment}
                                  aria-pressed={entry.followUps[f.id] === o.value}
                                  data-ph-safe=""
                                  onClick={() =>
                                    onChange((e) => {
                                      const followUps = { ...e.followUps };
                                      if (followUps[f.id] === o.value) delete followUps[f.id];
                                      else followUps[f.id] = o.value;
                                      return { ...e, followUps };
                                    })
                                  }
                                >
                                  {o.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>

        {def.measures.map((m) => (
          <MeasureField key={m.id} measure={m} entry={entry} onChange={onChange} />
        ))}

        <div className={styles.safety}>
          <div className={styles.discomfort}>
            <p className={styles.followTitle} id="discomfort-label">Discomfort reported</p>
            <div className={styles.toggles} role="group" aria-labelledby="discomfort-label">
              {(['L', 'R'] as const).map((side) => {
                const on = side === 'L' ? entry.discomfortLeft : entry.discomfortRight;
                return (
                  <button
                    key={side}
                    type="button"
                    className={styles.toggle}
                    aria-pressed={on}
                    aria-label={`Discomfort ${SIDE_WORD[side]}`}
                    onClick={() => onChange((e) => (side === 'L' ? { ...e, discomfortLeft: !on } : { ...e, discomfortRight: !on }))}
                  >
                    {side}
                  </button>
                );
              })}
            </div>
          </div>
          <Button variant="secondary" size="compact" onClick={onStop} disabled={busy} phSafe>
            Stop test
          </Button>
        </div>

        <TextAreaField
          label="Note"
          value={entry.note}
          placeholder="Add a note"
          rows={2}
          maxLength={1000}
          onChange={(e) => {
            const note = e.target.value;
            onChange((x) => ({ ...x, note }));
          }}
        />
      </div>
    </div>
  );
}

function CheckpointRow({ checkpoint: c, results, onRate }: { checkpoint: CheckpointDef; results: readonly CheckpointResult[]; onRate: (id: string, side: Side, s: Severity) => void }) {
  const sides: Side[] = c.sided ? ['L', 'R'] : ['none'];
  const seen = sides.some((s) => severityOf(results, c.id, s) !== 'normal');
  return (
    <>
      <p className={styles.checkpointLabel} data-ph-safe="">
        {seen ? <span className={styles.dot} aria-hidden="true" /> : null}
        {c.label}
      </p>
      <div className={styles.sideRows}>
        {sides.map((side) => {
          const current = severityOf(results, c.id, side);
          const name = side === 'none' ? c.label : `${c.label}, ${SIDE_WORD[side]}`;
          return (
            <div key={side} className={styles.sideRow}>
              {side === 'none' ? null : (
                <span className={styles.sideLabel} aria-hidden="true">{side}</span>
              )}
              <div className={styles.severity} role="group" aria-label={name} title={c.guide ? `Slight: ${c.guide.slight}. Severe: ${c.guide.severe}.` : undefined}>
                {(['normal', 'slight', 'severe'] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={styles.sevButton}
                    data-level={level}
                    aria-pressed={current === level}
                    data-ph-safe=""
                    // Tapping the chosen Slight or Severe again goes back to Normal.
                    onClick={() => onRate(c.id, side, level !== 'normal' && current === level ? 'normal' : level)}
                  >
                    {level === 'normal' ? 'Normal' : level === 'slight' ? 'Slight' : 'Severe'}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function MeasureField({ measure: m, entry, onChange }: { measure: MeasureDef; entry: TestEntry; onChange: (u: (e: TestEntry) => TestEntry) => void }) {
  const sides: Side[] = m.sided ? ['L', 'R'] : ['none'];
  const valueOf = (side: Side) => entry.measures.find((x) => x.measureId === m.id && x.side === side)?.value;
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(sides.map((s) => [s, valueOf(s)?.toString() ?? ''])));
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  return (
    <fieldset className={styles.measures} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <legend className={styles.kicker} data-ph-safe="">{m.label}</legend>
      {sides.map((side) => {
        const id = `measure-${m.id}-${side}`;
        const error = errors[side] ?? null;
        return (
          <div key={side}>
            <div className={styles.measureRow}>
              {side === 'none' ? null : (
                <span className={styles.sideLabel} aria-hidden="true">{side}</span>
              )}
              <input
                id={id}
                className={styles.measureInput}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                aria-label={side === 'none' ? m.label : `${m.label}, ${SIDE_WORD[side]}`}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                value={text[side] ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  setText((t) => ({ ...t, [side]: raw }));
                  const trimmed = raw.trim().replace(',', '.');
                  const n = Number(trimmed);
                  const bad = trimmed !== '' && (!/^\d+(\.\d+)?$/.test(trimmed) || n < m.min || n > m.max);
                  setErrors((x) => ({ ...x, [side]: bad ? `Enter a number from ${m.min} to ${m.max}.` : null }));
                  if (bad) return;
                  onChange((x) => {
                    const measures = x.measures.filter((v) => !(v.measureId === m.id && v.side === side));
                    if (trimmed !== '') measures.push({ measureId: m.id, side, value: n });
                    return { ...x, measures };
                  });
                }}
              />
              <span className={styles.caption} aria-hidden="true">{UNIT[m.unit]}</span>
            </div>
            {error ? (
              <p id={`${id}-error`} className={styles.measureError}>{error}</p>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
