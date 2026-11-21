'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EVIDENCE_LABELS,
  SLOT_LABELS,
  buildSuggestedWorkout,
  confirmedGroups,
  defaultPicks,
  doseText,
  exerciseOptions,
  livePicks,
  observedFindings,
  regionSideLabel,
  suggestFromFindings,
  suggestedWorkoutName,
  type CorrectiveChoice,
  type CorrectivePick,
  type ErrorCode,
  type ExercisePrefs,
  type MuscleId,
  type OptionGroup,
  type StoredMark,
  type Units,
  type WorkoutDoc,
} from '@caltracker/shared';
import { MarkChip, sidesText } from '@/components/assessment-findings/labels';
import { ReloadButton } from '@/components/reload-button';
import { Button, ErrorText, PhoneActionBar } from '@/components/ui';
import { failureCode } from '@/lib/action-errors';
import { useLocalToday } from '@/lib/local-today';
import { useMediaQuery } from '@/lib/use-media-query';
import calendar from '@/components/calendar/calendar.module.css';
import { WorkoutSheet } from '../../../programs/[id]/workout-sheet';
import { finishAssessment, saveAssessmentPicks } from './actions';
import type { AssessmentDetail } from './load';
import base from './assessments.module.css';
import styles from './findings.module.css';

const AUTOSAVE_MS = 500;
/** Phone: the first three muscles open, the rest folded (board AS5). */
const OPEN_ON_PHONE = 3;
type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; code: ErrorCode };
const groupKey = (g: { muscleId: MuscleId; status: string }) => `${g.muscleId}|${g.status}`;

/**
 * Exercises per confirmed muscle (board AS5): one group per confirmed muscle and status, 2–4 options each, the coach's
 * own first ("Yours"), then built-in defaults with their evidence. Tap to pick, as many as you like; before the
 * first pick the coach's own are ticked, or the top built-in where there are none. "Make suggested workout" finishes
 * the assessment (if still a draft) and opens the picks in the normal workout builder (AS5b), where "Assign to
 * client" puts it on a day. "Finish without a workout" finishes it with no workout.
 */
export function ExercisesView({
  client,
  assessment,
  marks,
  savedPicks,
  coach,
  builtins,
  labels,
  current,
  units,
  workspaceId,
  prefs,
}: {
  client: { id: string; name: string; firstName: string };
  assessment: AssessmentDetail;
  marks: StoredMark[];
  savedPicks: CorrectivePick[] | null;
  coach: CorrectiveChoice[];
  builtins: CorrectiveChoice[];
  labels: Record<string, string>;
  current: boolean;
  units: Units;
  workspaceId: string;
  prefs: Record<string, ExercisePrefs>;
}) {
  const router = useRouter();
  const today = useLocalToday();
  const phone = useMediaQuery('(max-width: 599.98px)');
  const [done, setDone] = useState(assessment.status === 'done');
  const groups: OptionGroup[] = useMemo(() => {
    const findings = observedFindings(assessment.tests.map((t) => ({ definition: t.definition, status: t.entry.status, results: t.entry.results })));
    const order = [...new Set(suggestFromFindings(findings).map((s) => s.muscleId))];
    return exerciseOptions(confirmedGroups(marks, order), coach, builtins, labels);
  }, [assessment.tests, marks, coach, builtins, labels]);
  const [picks, setPicksState] = useState<CorrectivePick[]>(() => livePicks(groups, savedPicks ?? defaultPicks(groups)));
  const latest = useRef(picks);
  const dirty = useRef(savedPicks === null && picks.length > 0);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.slice(0, OPEN_ON_PHONE).map(groupKey)));
  const [busy, setBusy] = useState<'make' | 'finish' | null>(null);
  const [sheet, setSheet] = useState<WorkoutDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));

  const persist = useCallback((): Promise<boolean> => {
    chain.current = chain.current.then(async () => {
      if (!dirty.current || !current) return true;
      dirty.current = false;
      setSave({ kind: 'saving' });
      try {
        const outcome = await saveAssessmentPicks(assessment.id, latest.current);
        if (!outcome.ok) {
          setSave({ kind: 'error', code: outcome.code });
          return false;
        }
        setSave({ kind: 'saved' });
        return true;
      } catch (e) {
        setSave({ kind: 'error', code: failureCode(e, 'assessment_save_failed') });
        return false;
      }
    });
    return chain.current;
  }, [assessment.id, current]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return persist();
  }, [persist]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function toggle(g: OptionGroup, exerciseId: string) {
    if (!current) return;
    const has = latest.current.some((p) => p.muscleId === g.muscleId && p.status === g.status && p.exerciseId === exerciseId);
    const next = has
      ? latest.current.filter((p) => !(p.muscleId === g.muscleId && p.status === g.status && p.exerciseId === exerciseId))
      : [...latest.current, { muscleId: g.muscleId, status: g.status, exerciseId }];
    latest.current = next;
    setPicksState(next);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), AUTOSAVE_MS);
  }

  /** Finishes a draft (score stored, results and findings locked). True when it is done. */
  async function finishIfDraft(): Promise<boolean> {
    if (done) return true;
    const outcome = await finishAssessment(assessment.id);
    if (!outcome.ok) {
      setSave({ kind: 'error', code: outcome.code });
      return false;
    }
    setDone(true);
    return true;
  }

  const ordered = livePicks(groups, picks);
  const uniqueCount = new Set(ordered.map((p) => p.exerciseId)).size;

  async function make() {
    if (busy || uniqueCount === 0 || !current) return;
    setBusy('make');
    try {
      if (!(await flush())) return;
      if (!(await finishIfDraft())) return;
      const doc = buildSuggestedWorkout({ name: suggestedWorkoutName(client.firstName), groups, picks: ordered, makeId: () => crypto.randomUUID() });
      if (doc) setSheet(doc);
    } catch (e) {
      setSave({ kind: 'error', code: failureCode(e, 'assessment_finish_failed') });
    } finally {
      setBusy(null);
    }
  }

  async function finishOnly() {
    if (busy) return;
    setBusy('finish');
    try {
      if (!(await flush())) return;
      if (!(await finishIfDraft())) return;
      // A full load: the same address now shows the summary, straight from the server.
      window.location.replace(`/clients/${client.id}/assessments/${assessment.id}`);
    } catch (e) {
      setSave({ kind: 'error', code: failureCode(e, 'assessment_finish_failed') });
    } finally {
      setBusy(null);
    }
  }

  async function back() {
    await flush();
    router.push(`/clients/${client.id}/assessments/${assessment.id}/findings`);
  }
  async function close() {
    await flush();
    router.push(done ? `/clients/${client.id}/assessments/${assessment.id}` : `/clients/${client.id}/limitations`);
  }

  const status = save.kind === 'saving' ? 'Saving…' : save.kind === 'saved' ? 'Saved' : null;
  const isOpen = (g: OptionGroup, i: number) => !phone || i < OPEN_ON_PHONE || open.has(groupKey(g));

  return (
    <div className={styles.page} data-testid="assessment-exercises">
      <header className={base.runHead}>
        <div>
          <p className={base.caption}>
            <span data-ph-safe="">{client.name}</span> · {SLOT_LABELS[assessment.slot]} · per confirmed muscle
          </p>
          <h1 className={base.runTitle}>Exercises</h1>
        </div>
        <button type="button" className={base.close} aria-label="Close" onClick={() => void close()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      {!current ? <p className={styles.lockedNote}>{client.name} is no longer your client, so these picks can’t change.</p> : null}

      {groups.length === 0 ? (
        <div className={styles.empty}>
          <strong>No confirmed muscles yet</strong>
          <p className={base.caption}>Go back to Findings and confirm (✓) the muscles you agree with. Each one gets a few exercises here.</p>
        </div>
      ) : (
        <ul className={styles.exGroups} aria-label="Muscles">
          {groups.map((g, i) => {
            const name = regionSideLabel(g.muscleId, 'none');
            const picked = g.options.filter((o) => ordered.some((p) => p.muscleId === g.muscleId && p.status === g.status && p.exerciseId === o.exerciseId)).length;
            const shown = isOpen(g, i);
            const head = (
              <>
                <span className={styles.exGroupName} data-ph-safe="">{name}</span>
                <MarkChip status={g.status} />
                <span className={base.caption}>{sidesText(g.sides)}</span>
                <span className={styles.exCount}>{shown ? `${picked} of ${g.options.length} picked` : `${picked} picked`}</span>
              </>
            );
            return (
              <li key={groupKey(g)} className={styles.exGroup} data-testid={`ex-group-${g.muscleId}-${g.status}`}>
                {phone && i >= OPEN_ON_PHONE ? (
                  <button
                    type="button"
                    className={styles.exToggle}
                    aria-expanded={shown}
                    onClick={() => setOpen((s) => {
                      const n = new Set(s);
                      if (n.has(groupKey(g))) n.delete(groupKey(g));
                      else n.add(groupKey(g));
                      return n;
                    })}
                  >
                    {head}
                    <span className={styles.exChevron} aria-hidden="true">⌄</span>
                  </button>
                ) : (
                  <div className={styles.exGroupHead}>{head}</div>
                )}
                {shown ? (
                  g.options.length === 0 ? (
                    <p className={base.caption}>No exercise suggested for this muscle yet.</p>
                  ) : (
                    <ul className={styles.options}>
                      {g.options.map((o) => {
                        const on = ordered.some((p) => p.muscleId === g.muscleId && p.status === g.status && p.exerciseId === o.exerciseId);
                        const meta = [o.evidence ? EVIDENCE_LABELS[o.evidence] : null, o.forLabel].filter(Boolean).join(' · ');
                        return (
                          <li key={o.exerciseId}>
                            <button type="button" className={styles.option} aria-pressed={on} disabled={!current} onClick={() => toggle(g, o.exerciseId)} data-testid="ex-option">
                              <span className={styles.thumb} aria-hidden="true">
                                {o.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element -- plain img keeps the app host-agnostic (no image optimizer)
                                  <img src={o.imageUrl} alt="" width={44} height={44} loading="lazy" />
                                ) : (
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12" /></svg>
                                )}
                              </span>
                              <span className={styles.optionText}>
                                <span className={styles.optionName}>
                                  <span data-ph-safe="">{o.name}</span>
                                  {o.yours ? <span className={styles.yours}>Yours</span> : null}
                                </span>
                                <span className={styles.optionMeta}>{doseText(o.dose)}</span>
                                {meta ? <span className={styles.optionMeta} data-ph-safe="">{meta}</span> : null}
                              </span>
                              <span className={styles.tick} aria-hidden="true">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {!done && current ? (
        <div className={styles.footerExtra}>
          <Button variant="quiet" onClick={() => void finishOnly()} pending={busy === 'finish'} phSafe data-testid="finish-without-workout">
            Finish without a workout
          </Button>
        </div>
      ) : null}
      {save.kind === 'error' ? (
        <div className={base.saveError}>
          <ErrorText code={save.code} />
          {save.code === 'stale_deploy' ? <ReloadButton className={calendar.smallButton} /> : null}
        </div>
      ) : null}
      <PhoneActionBar status={status ? <span className={base.statusOk}>{status}</span> : undefined} label="Exercise actions">
        <Button variant="secondary" className={styles.backButton} onClick={() => void back()} phSafe>Back</Button>
        <Button
          onClick={() => void make()}
          pending={busy === 'make'}
          aria-disabled={uniqueCount === 0 || !current}
          aria-describedby={uniqueCount === 0 ? 'make-why' : undefined}
          phSafe
          data-testid="make-suggested"
        >
          Make suggested workout · {uniqueCount}
        </Button>
      </PhoneActionBar>
      {uniqueCount === 0 ? <p id="make-why" className={base.caption}>Pick at least one exercise to make the workout.</p> : null}

      {sheet ? (
        <WorkoutSheet
          target={{ kind: 'suggested', clientId: client.id, clientName: client.name, today, doc: sheet }}
          units={units}
          workspaceId={workspaceId}
          exercisePrefs={prefs}
          onSaved={(saved) => {
            setSheet(null);
            if (saved.kind !== 'client') return;
            router.push(`/clients/${client.id}/training?from=${saved.date}`);
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}
