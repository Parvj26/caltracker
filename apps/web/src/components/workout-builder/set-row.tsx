'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import {
  setKindOf,
  setKindPatch,
  singleReps,
  targetFieldsFor,
  distanceUnitFor,
  formatClock,
  fromMeters,
  kgToInput,
  parseClock,
  stepReps,
  stepWeight,
  toKg,
  toMeters,
} from '@caltracker/shared';
import type { TrackingType, Units, WorkoutSetDoc } from '@caltracker/shared';
import { ErrorText } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { Icon } from './icons';
import { REST_PICKS, activeRestPick, restPickLabel, restPicksShown } from './rest-picks';
import { SetTypeMenu } from './set-type-menu';
import styles from './builder.module.css';

export type SetPatch = Partial<Omit<WorkoutSetDoc, 'id'>>;

/** Blank text is null; text that is not a number is NaN (kept in the box, not saved). */
export function parseDecimal(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}

export function parseWhole(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  label: string;
  value: number | null;
  format: (n: number) => string;
  parse: (text: string) => number | null;
  onCommit: (n: number | null) => void;
  /** Changes when something else set the value (a Rest quick pick): the box drops what was typed and shows it. */
  resetKey?: number;
};

/** Selects the whole box, so the next key replaces the number (10 → 8, not 108). */
function selectAll(el: HTMLInputElement) {
  if (document.activeElement === el) el.setSelectionRange(0, el.value.length);
}

/**
 * A text box for a number. While the coach types, the box shows exactly what they typed (so "61." or "1:" are not
 * rewritten mid-entry); each readable value is saved to the doc at once. While the text can't be read (say "190"
 * in a clock box), the doc goes back to the value the box had at focus, so a half-typed "19" is not left saved.
 * On blur it shows the doc's value again, or keeps unreadable text on screen, marked invalid.
 * Tapping or tabbing into a filled box selects its number, so typing replaces it instead of landing mid-number.
 */
export function NumberInput({ label, value, format, parse, onCommit, resetKey = 0, className, onFocus, onBlur, onPointerDown, onPointerUp, ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [shownKey, setShownKey] = useState(resetKey);
  if (shownKey !== resetKey) {
    setShownKey(resetKey);
    setDraft(null);
  }
  // True during a tap that focuses the box: Safari places the caret when that tap ends, undoing the selection.
  const focusingTap = useRef(false);
  // The doc's value when the box got focus: what an unreadable draft falls back to.
  const atFocus = useRef<number | null>(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // After a quick pick: what an unreadable draft falls back to now, and the box selected so typing replaces it.
  useEffect(() => {
    if (resetKey === 0) return;
    atFocus.current = value;
    if (inputRef.current) selectAll(inputRef.current);
    // Only when a pick happened (value is read at that moment).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  const invalid = draft !== null && Number.isNaN(parse(draft));
  return (
    <input
      {...rest}
      ref={inputRef}
      onFocus={(e) => {
        onFocus?.(e);
        // An invalid draft kept from the last blur was never saved, so the doc value is still the one to restore.
        atFocus.current = value;
        const el = e.currentTarget;
        // iOS ignores a selection made inside the focus event, so select once it has settled.
        setTimeout(() => selectAll(el), 0);
      }}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        focusingTap.current = document.activeElement !== e.currentTarget;
      }}
      onPointerUp={(e) => {
        onPointerUp?.(e);
        if (!focusingTap.current) return;
        // A second tap in a box that already has focus still places the caret, as usual.
        focusingTap.current = false;
        const el = e.currentTarget;
        requestAnimationFrame(() => selectAll(el));
      }}
      type="text"
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={cx(styles.input, className)}
      value={draft ?? (value === null ? '' : format(value))}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = parse(text);
        if (n === null || !Number.isNaN(n)) onCommit(n);
        else if (value !== atFocus.current) onCommit(atFocus.current);
      }}
      onBlur={(e) => {
        onBlur?.(e);
        if (!invalid) setDraft(null);
      }}
    />
  );
}

/**
 * The Rest box, with quick picks (0:30, 1:00, 1:30, 2:00) while it has focus. A pick fills the box in one tap; the
 * one that matches is black. Pressing a pick never takes focus from the box (pointerdown's default is prevented),
 * so typing carries on and the keyboard stays up. On a phone the picks sit under the box and are scrolled above the
 * keyboard; they drop down under the box, over the rows below, so the row keeps its height.
 */
function RestInput({
  value,
  onCommit,
  onFocus,
  onBlur,
}: {
  value: number | null;
  onCommit: (n: number | null) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  // Bumps on each pick, so the box shows the picked value even while it holds a typed draft.
  const [round, setRound] = useState(0);
  const picksRef = useRef<HTMLDivElement>(null);
  const shown = restPicksShown({ focused, hasRestBox: true });
  const active = activeRestPick(value);
  // Touch screens: keep the picks in view above the on-screen keyboard (the sheet shrinks to the visible part as it opens).
  useEffect(() => {
    if (!shown || !window.matchMedia('(pointer: coarse)').matches) return;
    const viewport = window.visualViewport;
    const reveal = () => picksRef.current?.scrollIntoView({ block: 'nearest' });
    const timer = setTimeout(reveal, 250);
    viewport?.addEventListener('resize', reveal);
    return () => {
      clearTimeout(timer);
      viewport?.removeEventListener('resize', reveal);
    };
  }, [shown]);
  return (
    <span className={styles.restWrap}>
      <NumberInput
        resetKey={round}
        label="Rest (m:ss)"
        inputMode="numeric"
        placeholder="m:ss"
        className={styles.narrow}
        value={value}
        format={formatClock}
        parse={parseClock}
        onCommit={onCommit}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
      />
      {shown ? (
        <div ref={picksRef} role="group" aria-label="Quick rest" className={styles.restPicks}>
          {REST_PICKS.map((p) => (
            <button
              key={p}
              type="button"
              tabIndex={-1}
              aria-pressed={p === active}
              className={styles.restPick}
              data-ph-capture-attribute-label="workout_rest_pick"
              // Keep focus (and the keyboard) on the Rest box.
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onCommit(p);
                setRound((r) => r + 1);
              }}
            >
              {restPickLabel(p)}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

type Props = {
  set: WorkoutSetDoc;
  /** The row's place in the exercise, from 1 (every row counts: warm-ups and drops too). */
  number: number;
  /** Accessible group name, e.g. "Barbell Squat set 2". */
  name: string;
  trackingType: TrackingType;
  units: Units;
  /** False in a superset for an exercise that goes straight on to the next one (no rest box). */
  showRest: boolean;
  canRemove: boolean;
  /** False on the first row: a drop must follow a set. */
  canDrop: boolean;
  errors: string[];
  onChange: (patch: SetPatch) => void;
  onRemove: () => void;
  /** A phone: smaller boxes (the column names say "Wt" at three measures). */
  compact?: boolean;
  /** The exercise has a Rest column (some set has a rest box): a row without one keeps the empty cell. */
  restColumn?: boolean;
};

/** Which box of a row has focus: the tray at the row's end shows its − / + (reps, weight) on touch screens. */
type Focused = 'reps' | 'weight' | 'duration' | 'distance' | 'rest' | null;

/** One box in a set row, on the columns the header names (SetTable). */
function Cell({ col, children }: { col: string; children: ReactNode }) {
  return (
    <span className={styles.setCell} data-col={col}>
      {children}
    </span>
  );
}

/**
 * One set as one slim row (SetTable puts the column names above, once): its number, its type letter (W / N / F / D,
 * see SetTypeMenu), one box per target the exercise tracks (reps, weight, time, distance) and rest, then a fixed slot
 * at the end. The slot holds × (remove the set); on touch screens, while the reps or weight box has focus, it holds
 * that box's − and + instead, so the row never changes height. Pressing − / + never takes focus from the box
 * (pointerdown's default is prevented), so the keyboard stays up. A desktop with a mouse has no − / +. A drop is
 * indented and has no rest of its own.
 */
export function SetRow({ set, number, name, trackingType, units, showRest, canRemove, canDrop, errors, onChange, onRemove, compact = false, restColumn = showRest }: Props) {
  const fields = targetFieldsFor(trackingType);
  const kind = setKindOf(set);
  const isDrop = set.setType === 'drop';
  const distanceUnit = distanceUnitFor(units);
  const [focused, setFocused] = useState<Focused>(null);
  // Bumps on each − / +, so the box shows the stepped value even while it holds a typed draft.
  const [stepped, setStepped] = useState(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const focusOn = (f: Focused) => {
    setFocused(f);
    // Keep the row in view below the column names (and above the keyboard).
    requestAnimationFrame(() => rowRef.current?.scrollIntoView({ block: 'nearest' }));
  };
  const blur = () => setFocused(null);
  const reps = singleReps(set.targetRepsMin, set.targetRepsMax);
  const stepField = (field: Focused, dir: 1 | -1) => {
    if (field === 'reps') {
      const n = stepReps(reps, dir);
      onChange({ targetRepsMin: n, targetRepsMax: n });
    } else if (field === 'weight') {
      onChange({ targetWeightKg: stepWeight(set.targetWeightKg, dir, units) });
    } else return;
    setStepped((k) => k + 1);
  };
  const step = (dir: 1 | -1) => stepField(focused, dir);
  /** ↑ / ↓ in the reps or weight box step it like + / − (the keyboard's way to them, on every size). */
  const arrows = (field: Focused, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    stepField(field, e.key === 'ArrowUp' ? 1 : -1);
  };
  const stepping = focused === 'reps' || focused === 'weight';
  const keep = (e: { preventDefault: () => void }) => e.preventDefault();
  const removeButton = (
    <button
      type="button"
      className={styles.removeSet}
      data-ph-capture-attribute-label="workout_remove_set"
      aria-label={`Remove set ${number}`}
      title={canRemove ? 'Remove set' : 'An exercise keeps at least one set'}
      disabled={!canRemove}
      onClick={onRemove}
    >
      <Icon name="close" size={18} />
    </button>
  );
  const typeMenu = <SetTypeMenu kind={kind} setName={name} canDrop={canDrop} onPick={(k) => onChange(setKindPatch(k))} />;

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label={name}
      className={cx(styles.setRow, isDrop && styles.dropRow)}
      data-focus={focused ?? undefined}
      data-compact={compact || undefined}
    >
      <span className={styles.setLabel} aria-hidden="true">
        {number}
      </span>
      <Cell col="type">{typeMenu}</Cell>

      {fields.includes('reps') ? (
        <Cell col="reps">
          <NumberInput
            label="Reps"
            inputMode="numeric"
            placeholder={set.toFailure ? 'max' : 'reps'}
            className={styles.narrow}
            value={reps}
            format={String}
            parse={parseWhole}
            resetKey={focused === 'reps' ? stepped : 0}
            onFocus={() => focusOn('reps')}
            onKeyDown={(e) => arrows('reps', e)}
            onBlur={blur}
            onCommit={(n) => onChange({ targetRepsMin: n, targetRepsMax: n })}
          />
        </Cell>
      ) : null}

      {fields.includes('weight') ? (
        <Cell col="weight">
          <NumberInput
            label={`Weight (${units})`}
            inputMode="decimal"
            placeholder={units}
            className={styles.narrow}
            value={set.targetWeightKg}
            format={(kg) => String(kgToInput(kg, units))}
            parse={parseDecimal}
            resetKey={focused === 'weight' ? stepped : 0}
            onFocus={() => focusOn('weight')}
            onKeyDown={(e) => arrows('weight', e)}
            onBlur={blur}
            onCommit={(n) => onChange({ targetWeightKg: n === null ? null : toKg(n, units) })}
          />
        </Cell>
      ) : null}

      {fields.includes('duration') ? (
        <Cell col="duration">
          <NumberInput
            label="Duration (m:ss)"
            inputMode="numeric"
            placeholder="m:ss"
            className={styles.narrow}
            value={set.targetDurationS}
            format={formatClock}
            parse={parseClock}
            onFocus={() => focusOn('duration')}
            onBlur={blur}
            onCommit={(n) => onChange({ targetDurationS: n })}
          />
        </Cell>
      ) : null}

      {fields.includes('distance') ? (
        <Cell col="distance">
          <NumberInput
            label={`Distance (${distanceUnit})`}
            inputMode="decimal"
            placeholder={distanceUnit}
            className={styles.narrow}
            value={set.targetDistanceM}
            format={(m) => String(fromMeters(m, distanceUnit))}
            parse={parseDecimal}
            onFocus={() => focusOn('distance')}
            onBlur={blur}
            onCommit={(n) => onChange({ targetDistanceM: n === null ? null : toMeters(n, distanceUnit) })}
          />
        </Cell>
      ) : null}

      {/* A drop goes straight on from the set above, so it has no rest; nor does a superset exercise that runs
          straight into the next one. Its column stays (empty), so the boxes line up. */}
      {showRest && !isDrop ? (
        <Cell col="rest">
          <RestInput value={set.restSeconds} onFocus={() => focusOn('rest')} onBlur={blur} onCommit={(n) => onChange({ restSeconds: n ?? 0 })} />
        </Cell>
      ) : restColumn ? (
        <span className={styles.setCell} data-col="rest" data-empty="" aria-hidden="true" />
      ) : null}

      {/* The fixed slot: × always on a desktop with a mouse; on touch, − / + for the focused reps or weight box. */}
      <span className={styles.setTray} data-stepping={stepping || undefined}>
        {stepping ? (
          <>
            <button
              type="button"
              className={styles.stepButton}
              aria-label={focused === 'reps' ? 'Fewer reps' : 'Less weight'}
              onPointerDown={keep}
              onMouseDown={keep}
              onClick={() => step(-1)}
              data-ph-capture-attribute-label="workout_step_down"
            >
              <span aria-hidden="true">−</span>
            </button>
            <button
              type="button"
              className={styles.stepButton}
              aria-label={focused === 'reps' ? 'More reps' : 'More weight'}
              onPointerDown={keep}
              onMouseDown={keep}
              onClick={() => step(1)}
              data-ph-capture-attribute-label="workout_step_up"
            >
              <span aria-hidden="true">+</span>
            </button>
          </>
        ) : null}
        {removeButton}
      </span>
      {errors.map((message) => (
        <ErrorText key={message} code="workout_fields_invalid" safe={false} className={styles.rowError}>
          {message}
        </ErrorText>
      ))}
    </div>
  );
}
