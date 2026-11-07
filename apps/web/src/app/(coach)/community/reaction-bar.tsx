'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  REACTIONS,
  applyReactionChange,
  invertReactionChange,
  reactionButtonLabel,
  reactionTap,
  summarizeReactions,
  whoReactedLabel,
  type ReactionKey,
  type ReactionRow,
} from '@caltracker/shared';
import { ErrorText } from '@/components/ui';
import { setReaction, type CommunityOutcome, type ReactionTarget } from './actions';
import styles from './community.module.css';

/**
 * The compact bar under a post or comment: each used reaction with its count (highlighted when the coach reacted),
 * a "+" that opens the six-choice picker, and a count that lists who reacted. Shows the change at once; the page's
 * refresh (or the server's error) settles it.
 */
export function ReactionBar({
  target,
  rows,
  viewer,
  label,
}: {
  target: ReactionTarget;
  rows: ReactionRow[];
  viewer: { userId: string; name: string };
  /** What the bar belongs to, for screen readers ("Reactions to Sam's post"). */
  label: string;
}) {
  const [shown, setShown] = useState(rows);
  const [seen, setSeen] = useState(rows);
  // The server's answer wins once the page refreshes.
  if (seen !== rows) {
    setSeen(rows);
    setShown(rows);
  }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [who, setWho] = useState<ReactionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const pickerId = useId();
  const plusRef = useRef<HTMLButtonElement>(null);
  const summary = summarizeReactions(shown, viewer.userId);
  const whoSummary = who ? summary.find((s) => s.key === who) : undefined;

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPickerOpen(false);
      plusRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  const toggle = (key: ReactionKey) => {
    const change = reactionTap(shown, viewer, key, new Date().toISOString());
    setShown((rows) => applyReactionChange(rows, change));
    setPickerOpen(false);
    setError(null);
    startTransition(async () => {
      const r: CommunityOutcome = await setReaction(target, key, change.op === 'add');
      if (!r.ok) {
        // Undo only this tap: other taps made since then stay.
        setShown((rows) => applyReactionChange(rows, invertReactionChange(change)));
        setError(r.error);
      }
    });
  };

  return (
    <div className={styles.reactions}>
      <div className={styles.reactionBar} role="group" aria-label={label} data-testid="reaction-bar">
        {summary.map((s) => (
          <span key={s.key} className={styles.reactionChip} data-mine={s.mine} data-testid={`reaction-${s.key}`}>
            <button type="button" className={styles.reactionToggle} aria-pressed={s.mine} aria-label={reactionButtonLabel(s)} onClick={() => toggle(s.key)}>
              <span aria-hidden="true">{s.emoji}</span>
            </button>
            <button
              type="button"
              className={styles.reactionCount}
              aria-label={whoReactedLabel(s)}
              aria-expanded={who === s.key}
              onClick={() => setWho(who === s.key ? null : s.key)}
            >
              {s.count}
            </button>
          </span>
        ))}
        <button
          ref={plusRef}
          type="button"
          className={styles.reactionAdd}
          aria-label="Add a reaction"
          aria-expanded={pickerOpen}
          aria-controls={pickerId}
          onClick={() => setPickerOpen(!pickerOpen)}
        >
          <span aria-hidden="true">☺+</span>
        </button>
      </div>
      {pickerOpen ? (
        <div id={pickerId} className={styles.reactionPicker} role="group" aria-label="Choose a reaction">
          {REACTIONS.map((r) => {
            const mine = shown.some((x) => x.userId === viewer.userId && x.reaction === r.key);
            return (
              <button
                key={r.key}
                type="button"
                className={styles.reactionChoice}
                aria-pressed={mine}
                aria-label={mine ? `Remove your ${r.label} reaction` : `React with ${r.label}`}
                onClick={() => toggle(r.key)}
              >
                <span aria-hidden="true">{r.emoji}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {whoSummary ? (
        <p className={styles.caption} data-testid="who-reacted">
          <span aria-hidden="true">{whoSummary.emoji} </span>
          <span className={styles.visuallyHidden}>Reacted with {whoSummary.label}: </span>
          {whoSummary.names.map((n, i) => (i === 0 ? n : `, ${n}`)).join('')}
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
