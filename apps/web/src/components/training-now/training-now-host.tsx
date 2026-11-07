'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { completedSetCount, openSetCount, type Units } from '@caltracker/shared';
import { SessionLogger } from '@/app/(coach)/clients/[clientId]/log/[workoutId]/session-logger';
import sessionStyles from '@/app/(coach)/clients/[clientId]/log/[workoutId]/session.module.css';
import { LiveRefresh, type LiveSource } from '@/components/live-refresh';
import { cx } from '@/components/ui/cx';
import { createBrowserSupabase } from '@/lib/supabase/client';
import type { SessionPane, TrainingPane } from '@/lib/training-now';
import { LiveView } from './live-view';
import styles from './live.module.css';

/** How often the row checks whether someone started or finished a workout. */
const POLL_MS = 8000;
/** A swipe counts only when it is clearly sideways: at least this far, and twice as wide as it is tall. */
const SWIPE_MIN_PX = 60;

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && el.closest('input, textarea, select, [contenteditable="true"]') !== null;

function SessionPaneView({ pane, units, onProgress }: { pane: SessionPane; units: Units; onProgress: (logId: string, done: number, total: number) => void }) {
  const report = useCallback((done: number, total: number) => onProgress(pane.logId, done, total), [onProgress, pane.logId]);
  return (
    <div className={sessionStyles.wide}>
      <Link href={`/clients/${pane.clientId}/training`} className={sessionStyles.back}>
        ← {pane.name}&apos;s calendar
      </Link>
      <SessionLogger
        // A take-over or a new session is a different log: start the screen afresh.
        key={pane.logId}
        client={{ id: pane.clientId, firstName: pane.firstName, name: pane.name }}
        workout={pane.workout}
        initialLog={pane.log}
        scheduledOn={pane.scheduledOn}
        units={units}
        lastTimes={pane.lastTimes}
        progression={pane.progression}
        onProgress={report}
      />
    </div>
  );
}

/**
 * Everyone training right now, one tab each: watch a client live or log your own session, and switch between them
 * with a tap or a sideways swipe. Once opened, a person's screen stays mounted (only hidden), so a session's unsaved ticks,
 * notes and page are kept while you look at someone else, and its own save loop carries on. The tabs show only when
 * two or more people are training.
 *
 * Watched workouts come in through LiveRefresh (a re-render on each save). The list of who is training is checked
 * every few seconds and the page re-rendered when it changes.
 */
export function TrainingNowHost({
  panes,
  inProgressIds,
  activeLogId,
  workspaceId,
  units,
  renderedAt,
}: {
  panes: TrainingPane[];
  inProgressIds: string[];
  activeLogId: string;
  workspaceId: string;
  units: Units;
  renderedAt: number;
}) {
  const router = useRouter();
  const [active, setActive] = useState(activeLogId);
  // Screens are mounted the first time someone is opened and then kept (hidden) while you look at someone else.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set([activeLogId]));
  // Sets done / in all for the coach's own sessions, as their screens report them (the server copy lags behind).
  const [sessionCounts, setSessionCounts] = useState<Record<string, { done: number; total: number }>>({});
  // Watched people's done counts as last seen, and who ticked a set since (the lime dot).
  const watchedCounts = Object.fromEntries(panes.filter((p) => p.kind === 'watch').map((p) => [p.logId, completedSetCount(p.log)]));
  const [seenCounts, setSeenCounts] = useState(watchedCounts);
  const [dots, setDots] = useState<ReadonlySet<string>>(() => new Set());
  if (Object.entries(watchedCounts).some(([id, n]) => seenCounts[id] !== n)) {
    const ticked = Object.entries(watchedCounts).filter(([id, n]) => id !== active && seenCounts[id] !== undefined && n > (seenCounts[id] ?? n));
    setSeenCounts(watchedCounts);
    if (ticked.length > 0) setDots(new Set([...dots, ...ticked.map(([id]) => id)]));
  }

  const current = panes.find((p) => p.logId === active) ?? null;
  const lastShown = useRef<TrainingPane | null>(current);
  useEffect(() => {
    if (current) {
      lastShown.current = current;
      return;
    }
    // The workout on screen finished (or was discarded): open its log, as the single-log page does.
    // (A session the coach finishes here opens its own log.)
    const gone = lastShown.current;
    if (gone?.kind === 'watch') router.replace(`/clients/${gone.clientId}/logs/${gone.logId}`);
  }, [current, router]);

  const switchTo = useCallback((logId: string) => {
    setActive(logId);
    setOpened((o) => (o.has(logId) ? o : new Set([...o, logId])));
    setDots((d) => {
      if (!d.has(logId)) return d;
      const next = new Set(d);
      next.delete(logId);
      return next;
    });
    // Remember the choice in the address, so a reload (and the next live re-render) shows the same person.
    const url = new URL(window.location.href);
    url.searchParams.set('with', logId);
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const onProgress = useCallback((logId: string, done: number, total: number) => {
    setSessionCounts((c) => (c[logId]?.done === done && c[logId]?.total === total ? c : { ...c, [logId]: { done, total } }));
  }, []);

  // Swipe left / right between people. Only a clearly sideways swipe counts, so scrolling up and down is untouched.
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    touch.current = e.touches.length === 1 && t && !isTyping(e.target) ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
  }
  function onTouchEnd(e: TouchEvent) {
    const start = touch.current;
    touch.current = null;
    const t = e.changedTouches[0];
    if (!start || !t || panes.length < 2) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < 2 * Math.abs(dy) || Date.now() - start.t > 1000) return;
    const at = panes.findIndex((p) => p.logId === active);
    const next = panes[at + (dx < 0 ? 1 : -1)];
    if (next) switchTo(next.logId);
  }

  // Someone started or finished a workout: re-render, so the tabs (and screens) match.
  const known = [...inProgressIds].sort().join(',');
  useEffect(() => {
    const supabase = createBrowserSupabase();
    let stopped = false;
    async function check() {
      if (document.visibilityState !== 'visible') return;
      const { data, error } = await supabase.from('workout_logs').select('id').eq('workspace_id', workspaceId).eq('status', 'in_progress');
      if (stopped || error) return;
      if (data.map((r) => r.id).sort().join(',') !== known) router.refresh();
    }
    const onVisible = () => void check();
    const timer = setInterval(onVisible, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [known, workspaceId, router]);

  const live: LiveSource[] = panes
    .filter((p) => p.kind === 'watch')
    .flatMap((p) => [
      { table: 'workout_logs', filter: `id=eq.${p.logId}` },
      { table: 'awards', filter: `log_id=eq.${p.logId}` },
    ]);
  const showTabs = panes.length >= 2;

  return (
    <div className={styles.host} data-training-now="" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {showTabs ? (
        <div className={cx(styles.band, styles.bleedSides, styles.bleedTop, current?.kind !== 'watch' && styles.bandSolo)}>
          <div className={cx(styles.inner, styles.tabRow)}>
            <p className={styles.tabLabel} id="training-now-label">
              TRAINING NOW
            </p>
            <div className={styles.tabs} role="tablist" aria-labelledby="training-now-label">
              {panes.map((p) => {
                const counts = p.kind === 'session' ? (sessionCounts[p.logId] ?? null) : null;
                const done = counts?.done ?? completedSetCount(p.log);
                const total = counts?.total ?? done + openSetCount(p.log);
                const selected = p.logId === active;
                const dot = dots.has(p.logId) && !selected;
                return (
                  <button
                    key={p.logId}
                    type="button"
                    role="tab"
                    id={`tab-${p.logId}`}
                    aria-selected={selected}
                    aria-controls={opened.has(p.logId) ? `pane-${p.logId}` : undefined}
                    aria-label={`${p.firstName}, ${done} of ${total} sets${dot ? ', new set ticked' : ''}`}
                    className={styles.tab}
                    onClick={() => switchTo(p.logId)}
                  >
                    <span className={cx(styles.avatar, styles[`tone-${p.tone}`])} aria-hidden="true">
                      {p.initials}
                    </span>
                    {p.firstName}
                    <span className={styles.tabCount}>
                      {done}/{total}
                    </span>
                    {dot ? <span className={styles.newTick} data-testid="new-tick" /> : null}
                  </button>
                );
              })}
            </div>
            <p className={styles.swipeHint}>Swipe ← → to switch</p>
          </div>
        </div>
      ) : null}

      {current ? null : <p className={styles.gone}>This workout just finished. Opening its log…</p>}
      {panes.filter((p) => opened.has(p.logId)).map((p) => (
        <div
          key={p.logId}
          id={`pane-${p.logId}`}
          role={showTabs ? 'tabpanel' : undefined}
          aria-labelledby={showTabs ? `tab-${p.logId}` : undefined}
          hidden={p.logId !== active}
          className={cx(p.kind === 'session' && (showTabs ? styles.paneGap : undefined))}
        >
          {p.kind === 'watch' ? <LiveView pane={p} units={units} joined={showTabs} /> : <SessionPaneView pane={p} units={units} onProgress={onProgress} />}
        </div>
      ))}
      {live.length > 0 ? <LiveRefresh on={live} renderedAt={renderedAt} /> : null}
    </div>
  );
}
