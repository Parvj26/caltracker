'use client';

import type { ErrorCode } from '@caltracker/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';
import {
  elapsedClock,
  exerciseProgressLabel,
  formatTotalWeight,
  isBlockDone,
  liveExercises,
  liveSetLine,
  liveStats,
  needsPick,
  sectionRuns,
  tickNote,
  upNext,
  whereTheyAre,
  type LogBlockDoc,
  type LogExerciseDoc,
  type UpNextItem,
  type Units,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import { takeOverSession } from '@/app/(coach)/clients/[clientId]/log/[workoutId]/actions';
import { Photo } from '@/components/exercise-search/photo';
import { ErrorText } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { failureCode } from '@/lib/action-errors';
import type { WatchPane } from '@/lib/training-now';
import styles from './live.module.css';

const subscribeSecond = (onChange: () => void) => {
  const timer = setInterval(onChange, 1000);
  return () => clearInterval(timer);
};
const secondNow = () => Math.floor(Date.now() / 1000);

/** The browser's clock to the second, or null on the server and during hydration. */
function useNowSecond(): number | null {
  const s = useSyncExternalStore(subscribeSecond, secondNow, () => null);
  return s === null ? null : s * 1000;
}

const doneIds = (log: WorkoutLogDoc) =>
  log.blocks
    .flatMap((b) => b.exercises.flatMap((e) => e.sets.filter((s) => s.completedAt !== null).map((s) => s.id)))
    .sort()
    .join(',');

/**
 * Sets ticked since the last copy of the log this view showed, for a brief lime flash. Worked out while rendering
 * (React's "adjust state when a prop changes"), so the flash starts with the very render that shows the tick.
 */
function useJustTicked(log: WorkoutLogDoc): ReadonlySet<string> {
  const [seen, setSeen] = useState(() => doneIds(log));
  const [flash, setFlash] = useState<ReadonlySet<string>>(() => new Set());
  const now = doneIds(log);
  if (now !== seen) {
    const before = new Set(seen.split(','));
    setSeen(now);
    setFlash(new Set(now.split(',').filter((id) => id && !before.has(id))));
  }
  useEffect(() => {
    if (flash.size === 0) return;
    const t = setTimeout(() => setFlash(new Set()), 1600);
    return () => clearTimeout(t);
  }, [flash]);
  return flash;
}

/**
 * Where they are: "<NAME> IS HERE" beside the exercise on iPad and desktop; on phones a shorter "HERE NOW" on its
 * own line (the long one wrapped onto two). Only one of the two is shown, so a screen reader reads it once.
 */
function HereTag({ name }: { name: string }) {
  return (
    <span className={styles.hereTag}>
      <span className={styles.hereLong}>{name.toUpperCase()} IS HERE</span>
      <span className={styles.hereShort}>HERE NOW</span>
    </span>
  );
}

/**
 * "Up next": the exercises still to come. `side` sits beside the workout on a landscape iPad (the page had a wide
 * empty strip); `phone` sits under the current exercise on an iPhone. Each is hidden at other widths, so only one
 * shows (and is read) at a time.
 */
function UpNext({ items, place }: { items: UpNextItem[]; place: 'side' | 'phone' }) {
  const id = `live-up-next-${place}`;
  return (
    <aside className={place === 'side' ? styles.upNext : styles.upNextPhone} aria-labelledby={id}>
      <h2 id={id} className={styles.upNextTitle}>
        Up next
      </h2>
      {items.length === 0 ? (
        <p className={styles.upNextEmpty}>Nothing after this one.</p>
      ) : (
        <ol className={styles.upNextList}>
          {items.map((item) => (
            <li key={item.exerciseId ?? `pick-${item.blockIndex}`} className={styles.upNextItem}>
              <span className={styles.upNextName}>{item.exerciseId === null ? `Pick one: ${item.name}` : item.name}</span>
              <span className={styles.upNextMeta}>
                {item.section ? `${item.section} · ` : ''}
                {item.setsLeft} {item.setsLeft === 1 ? 'set' : 'sets'} to go
              </span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function ExerciseRow({
  exercise,
  photo,
  units,
  here,
  hereName,
  note,
  pr,
  flash,
}: {
  exercise: LogExerciseDoc;
  photo: string | null;
  units: Units;
  here: boolean;
  hereName: string;
  note: string | null;
  pr: boolean;
  flash: boolean;
}) {
  const line = liveSetLine(exercise, units);
  const progress = exerciseProgressLabel(exercise);
  return (
    <li
      className={cx(styles.exercise, here && styles.here, flash && styles.flash)}
      aria-label={exercise.exerciseName}
      data-here={here || undefined}
      data-flash={flash || undefined}
    >
      <Photo src={photo} alt="" width={72} height={72} className={styles.photo ?? ''} />
      <div className={styles.exerciseText}>
        <span className={styles.exerciseName}>
          {exercise.exerciseName}
          {here ? <HereTag name={hereName} /> : null}
        </span>
        <span className={cx(styles.setLine, line.done.length === 0 && styles.setLineTodo)} data-testid="set-line">
          {line.done.length > 0 ? <span className={styles.doneSets}>{line.done.map((t) => `✓ ${t}`).join(', ')}</span> : null}
          {line.done.length > 0 && line.planned.length > 0 ? ' ' : null}
          {line.planned.length > 0 ? (
            <span className={line.done.length > 0 ? styles.plannedSets : undefined}>
              {line.done.length > 0 ? '· ' : ''}
              {line.planned.join(', ')}
            </span>
          ) : null}
          {pr ? <span className={styles.prTag}>PR</span> : null}
        </span>
        {note ? <span className={styles.tickNote}>{note}</span> : null}
      </div>
      <span className={cx(styles.count, styles[`count-${progress.state}`])}>{progress.text}</span>
    </li>
  );
}

function blockLabel(block: LogBlockDoc, round: { round: number | null; rounds: number | null } | null): string | null {
  if (block.kind === 'superset') return round?.round ? `SUPERSET · ROUND ${round.round} OF ${round.rounds}` : 'SUPERSET';
  if (block.kind === 'choice') return 'PICK ONE';
  return null;
}

/**
 * Watching a client (or another coach) log a workout, live: a dark header with the elapsed time, sets, volume and
 * PRs, then the whole workout the way the client's overview shows it, with where they are now. The page's
 * LiveRefresh brings each save in as a new `pane.log`; sets ticked since the last copy flash lime.
 */
export function LiveView({ pane, units, joined }: { pane: WatchPane; units: Units; /** Sits under the Training now tabs. */ joined: boolean }) {
  const router = useRouter();
  const { log } = pane;
  const now = useNowSecond();
  const flash = useJustTicked(log);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const stats = liveStats(log, pane.award);
  const position = whereTheyAre(log);
  const runs = sectionRuns(log.blocks, log.sections);
  const hereName = pane.holder.kind === 'client' ? pane.firstName : pane.holder.name;
  const next = upNext(log, 4);

  function takeOver() {
    if (!log.workoutId) return;
    const workoutId = log.workoutId;
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await takeOverSession(log.id);
        if (!outcome.ok) {
          setError(outcome.code);
          return;
        }
        router.push(`/clients/${pane.clientId}/log/${workoutId}`);
      } catch (e) {
        setError(failureCode(e, 'session_takeover_failed'));
      }
    });
  }

  return (
    <div className={styles.live}>
      <header className={cx(styles.head, styles.bleedSides, !joined && styles.bleedTop, joined && styles.headJoined)}>
        <div className={cx(styles.inner, styles.innerWide, styles.headInner)}>
          <div className={styles.headTop}>
            <p className={styles.liveLabel}>
              <span className={styles.liveDot} aria-hidden="true" />
              LIVE · {pane.name.toUpperCase()}
              {pane.holder.kind === 'other_coach' ? ` · LOGGED BY ${pane.holder.name.toUpperCase()}` : ''}
            </p>
            <div className={styles.headActions}>
              <Link href={`/messages/${pane.clientId}`} className={styles.ghost}>
                Message
              </Link>
              {log.workoutId ? (
                <button type="button" className={styles.takeOver} onClick={takeOver} disabled={pending} aria-busy={pending || undefined}>
                  {pending ? 'Taking over…' : 'Take over'}
                </button>
              ) : null}
            </div>
          </div>
          <h1 className={styles.title}>{log.name}</h1>
          <ul className={styles.stats} aria-label="Progress">
            <li>
              <b data-testid="elapsed">{now === null ? '–:––' : elapsedClock(log.startedAt, now)}</b> elapsed
            </li>
            <li>
              <b>
                {stats.done} of {stats.total}
              </b>{' '}
              sets
            </li>
            <li>
              <b>{formatTotalWeight(stats.volumeKg, units)}</b> lifted
            </li>
            {stats.prCount > 0 ? (
              <li>
                <b className={styles.prStat}>
                  {stats.prCount} {stats.prCount === 1 ? 'PR' : 'PRs'}
                </b>
              </li>
            ) : null}
          </ul>
          <div
            className={styles.bar}
            role="progressbar"
            aria-label="Sets done"
            aria-valuemin={0}
            aria-valuemax={stats.total}
            aria-valuenow={stats.done}
          >
            <div className={styles.barFill} style={{ width: `${Math.round(stats.fraction * 100)}%` }} />
          </div>
          {error ? (
            <ErrorText code={error} className={styles.error} />
          ) : null}
        </div>
      </header>

      <div className={cx(styles.inner, styles.innerWide, styles.body)}>
        <div className={styles.timeline}>
          {runs.map((run) => {
            const blocks = run.blockIndexes.map((i) => ({ block: log.blocks[i]!, index: i }));
            const onNow = position !== null && run.blockIndexes.includes(position.blockIndex);
            const done = blocks.every(({ block }) => isBlockDone(block));
            return (
              <section key={run.blockIndexes[0]} className={styles.section} aria-label={run.section?.name ?? 'Exercises'} data-on-now={onNow || undefined}>
                <div className={styles.rail} aria-hidden="true">
                  <span className={cx(styles.railDot, done && styles.railDone, onNow && styles.railNow)}>{done && !onNow ? '✓' : ''}</span>
                  <span className={styles.railLine} />
                </div>
                <div className={styles.sectionBody}>
                  {/* "ON NOW" in words only: the pulsing dot on the rail beside it is the one live marker (a dot glyph
                      in the text made a second one). */}
                  {run.section ? (
                    <h2 className={styles.sectionTitle}>
                      {run.section.name}
                      {onNow ? <span className={styles.onNow}>ON NOW</span> : null}
                    </h2>
                  ) : onNow ? (
                    <p className={styles.onNow}>ON NOW</p>
                  ) : null}
                  {blocks.map(({ block, index }) => {
                    const hereBlock = position?.blockIndex === index;
                    const label = blockLabel(block, hereBlock ? position : null);
                    // A pick-one group not picked yet shows every option; otherwise only what is being done.
                    const shown = needsPick(block) ? block.exercises : liveExercises(block).map((e) => e.exercise);
                    return (
                      <div key={block.id} className={styles.sectionBody}>
                        {label ? (
                          <p className={styles.blockLabel}>
                            {label}
                            {hereBlock && position?.exerciseId === null ? <HereTag name={hereName} /> : null}
                          </p>
                        ) : null}
                        <ul className={styles.list}>
                          {shown.map((exercise) => {
                            const here = hereBlock && position?.exerciseId === exercise.id;
                            const last = position?.lastTicked;
                            const note = here && last && last.exerciseId === exercise.id && now !== null ? tickNote(exercise, last.setIndex, now, units) : null;
                            return (
                              <ExerciseRow
                                key={exercise.id}
                                exercise={exercise}
                                photo={pane.photos[exercise.exerciseId] ?? null}
                                units={units}
                                here={here}
                                hereName={hereName}
                                note={note}
                                pr={stats.prExerciseIds.includes(exercise.exerciseId)}
                                flash={exercise.sets.some((s) => flash.has(s.id))}
                              />
                            );
                          })}
                        </ul>
                        {hereBlock ? <UpNext items={next} place="phone" /> : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        {position ? <UpNext items={next} place="side" /> : null}
      </div>
    </div>
  );
}
