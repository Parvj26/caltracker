'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addLogSet,
  blockRoundCount,
  completeAllSets,
  completeSetWith,
  completedSetCount,
  discardLog,
  distanceUnitFor,
  finishLog,
  formatClock,
  formatLastResult,
  fromMeters,
  isBlockDone,
  isChoiceLocked,
  kgToInput,
  liveExercises,
  needsPick,
  openSetCount,
  parseClock,
  pickChoice,
  planSummary,
  resolveSetValues,
  sectionRuns,
  setExerciseNote,
  setLogNotes,
  startLogFromWorkout,
  stepName,
  toKg,
  toMeters,
  uncompleteSet,
  updateActual,
  type ActualPatch,
  type LogBlockDoc,
  type LogExerciseDoc,
  type LogSetDoc,
  type TrackingType,
  type Units,
  type WorkoutDoc,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import { Button, Card, ErrorText } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { failureMessage } from '@/lib/action-errors';
import type { LastTimes } from '@/lib/coach-session';
import { handBackSession, loadSession, saveSession } from './actions';
import styles from './session.module.css';

type Field = 'weight' | 'reps' | 'time' | 'distance';
type SaveState = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error' | 'final'; message: string };

const SAVE_DELAY_MS = 400;
const RETRY_MS = 3000;
const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

const FIELDS: Record<TrackingType, Field[]> = {
  weight_reps: ['weight', 'reps'],
  reps: ['reps'],
  time: ['time'],
  distance: ['distance'],
  weight_time: ['weight', 'time'],
};

/** A set's short label in the SET column: W for a warm-up, D for a drop, else the working set's number. */
function setLabel(sets: readonly LogSetDoc[], index: number): string {
  const s = sets[index]!;
  if (s.setType === 'warmup') return 'W';
  if (s.setType === 'drop') return 'D';
  return String(sets.slice(0, index + 1).filter((x) => x.setType === 'normal').length);
}

/** A value in the coach's units, as the box shows it. */
function toText(field: Field, value: number | null, units: Units): string {
  if (value === null) return '';
  switch (field) {
    case 'weight':
      return String(kgToInput(value, units));
    case 'reps':
      return String(value);
    case 'time':
      return formatClock(value);
    case 'distance':
      return String(fromMeters(value, distanceUnitFor(units)));
  }
}

/** What was typed, in stored units (kg, metres, seconds); null for blank; undefined when it is not allowed. */
function fromText(field: Field, text: string, units: Units): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  if (field === 'time') {
    const s = parseClock(t);
    return s !== null && s <= 86400 ? s : undefined;
  }
  if (!/^\d*\.?\d+$/.test(t)) return undefined;
  const n = Number(t);
  if (field === 'reps') return Number.isInteger(n) && n <= 1000 ? n : undefined;
  if (field === 'weight') {
    const kg = toKg(n, units);
    return kg <= 1000 ? kg : undefined;
  }
  const m = toMeters(n, distanceUnitFor(units));
  return m <= 1_000_000 ? m : undefined;
}

const actualOf = (s: LogSetDoc, f: Field) =>
  f === 'weight' ? s.actualWeightKg : f === 'reps' ? s.actualReps : f === 'time' ? s.actualDurationS : s.actualDistanceM;
const patchOf = (f: Field, v: number | null): ActualPatch =>
  f === 'weight' ? { actualWeightKg: v } : f === 'reps' ? { actualReps: v } : f === 'time' ? { actualDurationS: v } : { actualDistanceM: v };
const prefillOf = (v: ReturnType<typeof resolveSetValues>, f: Field) =>
  f === 'weight' ? v.weightKg : f === 'reps' ? v.reps : f === 'time' ? v.durationS : v.distanceM;

/** One number box. Shows the stored number, or the pre-filled one greyed (that is what a tick saves). */
function NumberCell({
  label,
  field,
  value,
  prefill,
  units,
  onCommit,
}: {
  label: string;
  field: Field;
  value: number | null;
  prefill: number | null;
  units: Units;
  onCommit: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? toText(field, value, units);
  const invalid = draft !== null && fromText(field, draft, units) === undefined;
  return (
    <input
      className={styles.cell}
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode={field === 'reps' ? 'numeric' : field === 'time' ? 'text' : 'decimal'}
      value={text}
      placeholder={toText(field, prefill, units)}
      onFocus={() => setDraft(toText(field, value, units))}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = fromText(field, e.target.value, units);
        if (v !== undefined) onCommit(v);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/** One exercise's table: SET | LB/KG | REPS | ✓, editable at any time, including after a tick. */
function ExerciseTable({
  exercise,
  letter,
  units,
  lastTime,
  edit,
}: {
  exercise: LogExerciseDoc;
  letter: string | null;
  units: Units;
  lastTime: LastTimes[string];
  edit: (fn: (l: WorkoutLogDoc) => WorkoutLogDoc) => void;
}) {
  const fields = FIELDS[exercise.trackingType];
  const header: Record<Field, string> = { weight: units.toUpperCase(), reps: 'REPS', time: 'TIME', distance: distanceUnitFor(units).toUpperCase() };
  const plan = planSummary(exercise, units);
  const last = formatLastResult(lastTime ?? [], exercise.trackingType, units);
  const name = `${letter ? `${letter}. ` : ''}${exercise.exerciseName}`;
  const [note, setNote] = useState(exercise.note ?? '');

  return (
    <section className={styles.exercise} aria-label={exercise.exerciseName}>
      <header className={styles.exerciseHead}>
        <h3 className={styles.exerciseName}>{name}</h3>
        {plan ? <p className={styles.caption}>Coach: {plan}</p> : null}
        <p className={styles.caption}>{last ?? 'Last time: first time'}</p>
      </header>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">SET</th>
            {fields.map((f) => (
              <th key={f} scope="col">
                {header[f]}
              </th>
            ))}
            <th scope="col">
              <span aria-hidden="true">✓</span>
              <span className={styles.srOnly}>Done</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {exercise.sets.map((s, i) => {
            const prefill = resolveSetValues(exercise, s.id, lastTime ?? []);
            const done = s.completedAt !== null;
            const setName = `${exercise.exerciseName} ${stepName(exercise, i)}`;
            return (
              <tr key={s.id} className={cx(done && styles.doneRow)}>
                <th scope="row">{setLabel(exercise.sets, i)}</th>
                {fields.map((f) => (
                  <td key={f}>
                    <NumberCell
                      label={`${header[f]}, ${setName}`}
                      field={f}
                      value={actualOf(s, f)}
                      prefill={prefillOf(prefill, f)}
                      units={units}
                      onCommit={(v) => edit((l) => updateActual(l, s.id, patchOf(f, v)))}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className={cx(styles.tick, done && styles.tickDone)}
                    aria-pressed={done}
                    aria-label={`Done: ${setName}`}
                    onClick={() =>
                      edit((l) => {
                        const ex = l.blocks.flatMap((b) => b.exercises).find((e) => e.id === exercise.id);
                        const set = ex?.sets.find((x) => x.id === s.id);
                        if (!ex || !set) return l;
                        return set.completedAt === null
                          ? completeSetWith(l, s.id, resolveSetValues(ex, s.id, lastTime ?? []), nowIso())
                          : uncompleteSet(l, s.id, nowIso());
                      })
                    }
                  >
                    ✓
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.rowActions}>
        <Button variant="secondary" className={styles.big} onClick={() => edit((l) => addLogSet(l, exercise.id, uuid, nowIso()))}>
          + Add set
        </Button>
      </div>
      <label className={styles.noteLabel}>
        <span>Note on {exercise.exerciseName}</span>
        <textarea
          className={styles.note}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => edit((l) => setExerciseNote(l, exercise.id, note.trim() ? note : null, nowIso()))}
        />
      </label>
    </section>
  );
}

/** A page's name in the list: the exercise, the superset's exercises, or the pick-one group's pick. */
function pageName(block: LogBlockDoc): string {
  if (block.kind === 'choice') {
    const picked = block.exercises.find((e) => e.id === block.pickedExerciseId);
    return picked ? picked.exerciseName : `Pick one: ${block.exercises.map((e) => e.exerciseName).join(' / ')}`;
  }
  return block.exercises.map((e) => e.exerciseName).join(' + ');
}

/** One page: a straight exercise, a superset (rounds) or a pick-one group. */
function BlockPage({
  block,
  units,
  lastTimes,
  edit,
}: {
  block: LogBlockDoc;
  units: Units;
  lastTimes: LastTimes;
  edit: (fn: (l: WorkoutLogDoc) => WorkoutLogDoc) => void;
}) {
  const superset = block.kind === 'superset';
  const rounds = blockRoundCount(block);
  return (
    <div className={styles.pageBody}>
      <div className={styles.pageHead}>
        <h2 className={styles.pageTitle}>
          {superset ? `Superset · ${rounds} ${rounds === 1 ? 'round' : 'rounds'}` : block.kind === 'choice' ? 'Pick one' : pageName(block)}
        </h2>
        {needsPick(block) ? null : (
          <Button variant="secondary" className={styles.big} onClick={() => edit((l) => completeAllSets(l, block.id, (id) => lastTimes[id] ?? [], nowIso()))}>
            Mark all
          </Button>
        )}
      </div>
      {block.kind === 'choice' ? (
        needsPick(block) ? (
          <div className={styles.options}>
            {block.exercises.map((e) => (
              <Button key={e.id} variant="secondary" className={styles.big} onClick={() => edit((l) => pickChoice(l, block.id, e.id, nowIso()))}>
                Do {e.exerciseName}
              </Button>
            ))}
          </div>
        ) : isChoiceLocked(block) ? null : (
          <button type="button" className={styles.textButton} onClick={() => edit((l) => pickChoice(l, block.id, null, nowIso()))}>
            Change pick
          </button>
        )
      ) : null}
      {liveExercises(block).map(({ exercise, exerciseIndex }) => (
        <ExerciseTable
          key={exercise.id}
          exercise={exercise}
          letter={superset ? String.fromCharCode(65 + exerciseIndex) : null}
          units={units}
          lastTime={lastTimes[exercise.exerciseId] ?? []}
          edit={edit}
        />
      ))}
    </div>
  );
}

/**
 * The coach's session: the same structure the client sees on the phone (sections, then each exercise, superset or
 * pick-one group as a page), with every edit made by the shared log operations and saved through
 * coach_save_workout_log. On a wide screen (iPad landscape, laptop) the pages list sits on the left and the current
 * page on the right; on a narrow one they stack.
 */
export function SessionLogger({
  client,
  workout,
  initialLog,
  units,
  lastTimes,
}: {
  client: { id: string; firstName: string; name: string };
  workout: WorkoutDoc;
  initialLog: WorkoutLogDoc | null;
  units: Units;
  lastTimes: LastTimes;
}) {
  const router = useRouter();
  const [log, setLog] = useState<WorkoutLogDoc | null>(initialLog);
  const [page, setPage] = useState(() => {
    const open = initialLog?.blocks.findIndex((b) => !isBlockDone(b)) ?? 0;
    return open < 0 ? 0 : open;
  });
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [notes, setNotes] = useState(initialLog?.notes ?? '');
  const [handingBack, setHandingBack] = useState(false);
  // Set before the last save of a hand back, so nothing typed meanwhile is lost or sent after the hand back.
  const handingBackRef = useRef(false);
  // Sets already ticked when this page opened: after a take over, some were logged on the client's phone.
  const [earlierSets] = useState(() => (initialLog ? completedSetCount(initialLog) : 0));

  const logRef = useRef<WorkoutLogDoc | null>(initialLog);
  const savedRevision = useRef(initialLog?.revision ?? 0);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);
  const flushRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));

  /** Sends the latest doc when it has changes the server doesn't have. Resolves true once it is saved. */
  const sendLatest = useCallback(async (): Promise<boolean> => {
    // Round again while edits arrived during a save, until the server has the latest.
    for (;;) {
      const doc = logRef.current;
      if (!doc || stopped.current) return false;
      if (doc.revision <= savedRevision.current) return true;
      setSave({ kind: 'saving' });
      try {
        const outcome = await saveSession({ clientId: client.id, doc });
        if (!outcome.ok) {
          if (outcome.final) {
            stopped.current = true;
            setSave({ kind: 'final', message: outcome.error });
          } else {
            setSave({ kind: 'error', message: outcome.error });
            timer.current = setTimeout(() => void flushRef.current(), RETRY_MS);
          }
          return false;
        }
        if (outcome.applied) {
          savedRevision.current = Math.max(savedRevision.current, doc.revision);
          setSave({ kind: 'saved' });
          continue;
        }
        if (outcome.loggedByOther) {
          stopped.current = true;
          setSave({ kind: 'final', message: `${client.firstName || 'Your client'} is logging this on their phone now.` });
          router.refresh();
          return false;
        }
        // Stale (this session is open in another tab too) or already finished: show the server's copy.
        const server = await loadSession(doc.id);
        if (server) {
          logRef.current = server;
          savedRevision.current = server.revision;
          setLog(server);
          setNotice('This session was changed somewhere else, so you now see the latest saved copy.');
        }
        setSave({ kind: 'saved' });
        return server?.status === doc.status;
      } catch (e) {
        setSave({ kind: 'error', message: failureMessage(e, "Couldn't save. Check your connection; it will try again.") });
        timer.current = setTimeout(() => void flushRef.current(), RETRY_MS);
        return false;
      }
    }
  }, [client.id, client.firstName, router]);

  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    chain.current = chain.current.then(sendLatest, sendLatest);
    return chain.current;
  }, [sendLatest]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /** Every edit goes through a shared log operation; a refused edit (the same doc back) saves nothing. */
  const edit = useCallback(
    (fn: (l: WorkoutLogDoc) => WorkoutLogDoc) => {
      const current = logRef.current;
      if (!current || current.status !== 'in_progress' || stopped.current || handingBackRef.current) return;
      const next = fn(current);
      if (next === current) return;
      logRef.current = next;
      setLog(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  function start() {
    // The server needs revision 1 or more; this is the session's first version.
    const doc = { ...startLogFromWorkout(workout, uuid, nowIso()), revision: 1 };
    logRef.current = doc;
    setLog(doc);
    setPage(0);
    void flush();
  }

  async function finish() {
    const current = logRef.current;
    if (!current) return;
    // A note typed but not yet left (no blur) still goes with the finish.
    const withNotes = setLogNotes(current, notes, nowIso());
    const finished = finishLog(withNotes, nowIso());
    if (finished === withNotes) {
      setNotice('Tick at least one set to finish the session.');
      return;
    }
    setFinishing(true);
    logRef.current = finished;
    setLog(finished);
    const saved = await flush();
    if (!saved || logRef.current?.status !== 'completed') {
      setFinishing(false);
      return;
    }
    // Open the finished log at once; it asks for the client's stickers, PRs and streaks itself (?award=1), so a slow
    // award never holds the coach up.
    router.push(`/clients/${client.id}/logs/${finished.id}?award=1`);
  }

  async function cancel() {
    const current = logRef.current;
    const who = client.firstName || 'the client';
    const warning =
      earlierSets > 0
        ? `Cancel this session? This throws away the whole workout, including the ${earlierSets} ${earlierSets === 1 ? 'set' : 'sets'} already logged before you opened it (after a take over, those are the ones ${who} logged on their phone). Nothing is saved to ${who}'s history.`
        : `Cancel this session? Nothing is saved to ${who}'s history.`;
    if (!current || !window.confirm(warning)) return;
    const discarded = discardLog(current, nowIso());
    logRef.current = discarded;
    setLog(discarded);
    if (await flush()) router.push(`/clients/${client.id}/training`);
  }

  /** Gives the workout back to the client's phone; they carry on from what is saved. */
  async function handBack() {
    const current = logRef.current;
    if (!current) return;
    // Stop edits first, then send what is typed so far: the client carries on from exactly that.
    handingBackRef.current = true;
    setHandingBack(true);
    const undo = () => {
      handingBackRef.current = false;
      setHandingBack(false);
    };
    const saved = await flush();
    if (!saved) {
      undo();
      return;
    }
    try {
      const outcome = await handBackSession(current.id);
      if (!outcome.ok) {
        setNotice(outcome.error);
        undo();
        return;
      }
    } catch (e) {
      setNotice(failureMessage(e, "Couldn't hand it back. Check your connection and try again."));
      undo();
      return;
    }
    stopped.current = true;
    router.push(`/clients/${client.id}/training`);
  }

  const status =
    save.kind === 'saving' ? 'Saving…' : save.kind === 'saved' ? 'All changes saved' : save.kind === 'error' ? save.message : '';

  if (!log) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>
          {workout.name} with {client.firstName || client.name}
        </h1>
        <Card className={styles.liveCard}>
          <p className={styles.caption}>
            You log this session here, with the coach&apos;s numbers filled in. {client.firstName || 'Your client'}&apos;s
            phone shows &ldquo;Your coach is logging this session&rdquo; until you finish.
          </p>
          <ul className={styles.preview}>
            {workout.blocks.map((b) => (
              <li key={b.id}>{b.kind === 'choice' ? `Pick one: ${b.exercises.map((e) => e.exerciseName).join(' / ')}` : b.exercises.map((e) => e.exerciseName).join(' + ')}</li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button className={styles.big} onClick={start} disabled={workout.blocks.length === 0}>
              Start session
            </Button>
          </div>
          {workout.blocks.length === 0 ? <p className={styles.caption}>This workout has no exercises yet. Add some first.</p> : null}
        </Card>
      </div>
    );
  }

  const block = log.blocks[page] ?? log.blocks[0];
  const done = completedSetCount(log);
  const total = done + openSetCount(log);
  const locked = log.status !== 'in_progress' || save.kind === 'final' || handingBack;

  return (
    <div className={styles.session}>
      <header className={styles.sessionHead}>
        <div>
          <h1 className={styles.title}>
            {log.name} with {client.firstName || client.name}
          </h1>
          <p className={styles.caption}>
            {done} of {total} {total === 1 ? 'set' : 'sets'} done · Logged by you
          </p>
        </div>
        <p role="status" className={styles.saveStatus}>
          {status}
        </p>
      </header>
      {save.kind === 'final' ? <ErrorText>{save.message}</ErrorText> : null}
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      <div className={styles.layout}>
        <nav aria-label="Exercises" className={styles.nav}>
          {sectionRuns(log.blocks, log.sections).map((run) => (
            <div key={run.blockIndexes[0]} className={styles.navRun}>
              {run.section ? <p className={styles.navSection}>{run.section.name}</p> : null}
              <ul className={styles.navList}>
                {run.blockIndexes.map((bi) => {
                  const b = log.blocks[bi]!;
                  const blockDone = isBlockDone(b);
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        className={cx(styles.navItem, bi === page && styles.navItemActive)}
                        aria-current={bi === page ? 'step' : undefined}
                        onClick={() => setPage(bi)}
                      >
                        <span className={styles.navName}>{pageName(b)}</span>
                        {blockDone ? (
                          <span>
                            <span aria-hidden="true">✓</span>
                            <span className={styles.srOnly}> done</span>
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className={styles.current} aria-label="Current exercise">
          {/* While locked the boxes and buttons stay visible but cannot change anything. */}
          <fieldset disabled={locked} className={styles.fieldset}>
            {block ? <BlockPage key={block.id} block={block} units={units} lastTimes={lastTimes} edit={edit} /> : null}
            <div className={styles.pager}>
              <Button variant="secondary" className={styles.big} disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                ← Previous
              </Button>
              <Button
                variant="secondary"
                className={styles.big}
                disabled={page >= log.blocks.length - 1}
                onClick={() => setPage((p) => Math.min(log.blocks.length - 1, p + 1))}
              >
                Next →
              </Button>
            </div>
          </fieldset>
        </div>
      </div>

      <fieldset disabled={locked || finishing || handingBack} className={cx(styles.fieldset, styles.footer)}>
        <label className={styles.noteLabel}>
          <span>Session note (the client sees it)</span>
          <textarea
            className={styles.note}
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => edit((l) => setLogNotes(l, notes, nowIso()))}
          />
        </label>
        <div className={styles.actions}>
          <Button variant="finish" className={styles.big} onClick={() => void finish()} pending={finishing}>
            {finishing ? 'Finishing…' : 'Finish session'}
          </Button>
          <Button variant="secondary" className={styles.big} onClick={() => void handBack()} pending={handingBack}>
            Hand back to {client.firstName || 'client'}
          </Button>
          <Button variant="secondary" className={styles.big} onClick={() => void cancel()}>
            Cancel session
          </Button>
        </div>
      </fieldset>
    </div>
  );
}
