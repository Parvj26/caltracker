'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  QUICK_REPS,
  REST_PRESETS,
  SET_KINDS,
  SET_KIND_NAMES,
  applyToAllPatches,
  distanceUnitFor,
  formatClock,
  fromMeters,
  kgToInput,
  parseClock,
  setKindOf,
  setKindPatch,
  singleReps,
  stepRepsFrom,
  stepSource,
  stepWeightFrom,
  targetFieldsFor,
  toKg,
  toMeters,
} from '@caltracker/shared';
import type { TrackingType, Units, WorkoutSetDoc } from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import { NumberInput, parseDecimal, parseWhole, type SetPatch } from './set-row';
import { useSheetKeyboardInset } from './use-keyboard-offset';
import styles from './builder.module.css';

type Props = {
  sets: readonly WorkoutSetDoc[];
  /** The set being edited (its place in `sets`). */
  index: number;
  /** "Barbell Squat", or "Barbell Deadlift (substitute)". */
  exerciseName: string;
  trackingType: TrackingType;
  units: Units;
  /** Per set: false for a superset exercise that runs straight into the next one (no rest). */
  restShown: readonly boolean[];
  onUpdate: (setId: string, patch: SetPatch) => void;
  onRemove: (setId: string) => void;
  /** ‹ and ›: edit another set without closing. */
  onGoTo: (index: number) => void;
  onClose: () => void;
};

/** − or + under a big box: the full half of the row, 44 px tall. */
function StepButton({ label, dir, onStep }: { label: string; dir: 1 | -1; onStep: () => void }) {
  return (
    <button type="button" className={styles.sheetStep} aria-label={label} onClick={onStep} data-ph-capture-attribute-label={dir === 1 ? 'workout_sheet_step_up' : 'workout_sheet_step_down'}>
      <span aria-hidden="true">{dir === 1 ? '+' : '−'}</span>
    </button>
  );
}

function Arrow({ label, flip, disabled, onClick }: { label: string; flip?: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.sheetArrow} aria-label={label} disabled={disabled} onClick={onClick}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
        <path d="M15 6l-6 6 6 6" />
      </svg>
    </button>
  );
}

/**
 * The phone set editor (round 2 mockup #3, option A): a bottom sheet over the builder for one set. Big boxes for the
 * set's values (reps and weight with − / + that start from the set before when the box is empty), quick rep chips,
 * rest, set type, "Apply to all N sets", ‹ › to the set before or after, and Done. Every change goes straight into
 * the workout, as the inline boxes do, so Done only closes. Stays above the iOS keyboard (useSheetKeyboardInset).
 */
export function SetSheet({ sets, index, exerciseName, trackingType, units, restShown, onUpdate, onRemove, onGoTo, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [applyAll, setApplyAll] = useState(false);
  useSheetKeyboardInset(ref);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // The heading, not the reps box: the keyboard shouldn't cover the steppers before the coach asks for it.
    headingRef.current?.focus();
  }, []);

  const set = sets[index]!;
  const fields = targetFieldsFor(trackingType);
  const kind = setKindOf(set);
  const isDrop = set.setType === 'drop';
  const showsRest = restShown[index] === true && !isDrop;
  const distanceUnit = distanceUnitFor(units);
  const reps = singleReps(set.targetRepsMin, set.targetRepsMax);
  const source = stepSource(sets, index, fields.filter((f) => f === 'reps' || f === 'weight'));

  // While "Apply to all" is ticked, every change to this set goes to the others too.
  useEffect(() => {
    if (!applyAll) return;
    for (const { id, patch } of applyToAllPatches(sets, index, restShown)) onUpdate(id, patch);
  }, [applyAll, sets, index, restShown, onUpdate]);

  const update = (patch: SetPatch) => onUpdate(set.id, patch);
  const setReps = (n: number | null) => update({ targetRepsMin: n, targetRepsMax: n });
  const goTo = (i: number) => {
    setApplyAll(false);
    onGoTo(i);
    headingRef.current?.focus();
  };

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      // A tap on the dimmed page around the sheet closes it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.sheetInner}>
        <span className={styles.sheetGrab} aria-hidden="true" />
        <div className={styles.sheetNav}>
          <Arrow label="Previous set" disabled={index === 0} onClick={() => goTo(index - 1)} />
          <div className={styles.sheetTitle}>
            <h2 id={titleId} ref={headingRef} tabIndex={-1} className={styles.sheetHeading}>
              Set {index + 1} of {sets.length}
            </h2>
            <span className={styles.caption}>
              {exerciseName}
              {source !== null ? ` · from set ${source + 1}` : ''}
            </span>
          </div>
          <Arrow label="Next set" flip disabled={index === sets.length - 1} onClick={() => goTo(index + 1)} />
        </div>

        <div className={styles.sheetBoxes}>
          {fields.includes('reps') ? (
            <div className={styles.sheetBox}>
              <span className={styles.sheetLabel} aria-hidden="true">Reps</span>
              <NumberInput
                key={`reps-${set.id}`}
                label="Reps"
                inputMode="numeric"
                placeholder={set.toFailure ? 'max' : '–'}
                className={styles.sheetInput}
                value={reps}
                format={String}
                parse={parseWhole}
                onCommit={setReps}
              />
              <div className={styles.sheetSteps}>
                <StepButton label="One less rep" dir={-1} onStep={() => setReps(stepRepsFrom(sets, index, -1))} />
                <StepButton label="One more rep" dir={1} onStep={() => setReps(stepRepsFrom(sets, index, 1))} />
              </div>
            </div>
          ) : null}
          {fields.includes('weight') ? (
            <div className={styles.sheetBox}>
              <span className={styles.sheetLabel} aria-hidden="true">{units}</span>
              <NumberInput
                key={`weight-${set.id}`}
                label={`Weight (${units})`}
                inputMode="decimal"
                placeholder="–"
                className={styles.sheetInput}
                value={set.targetWeightKg}
                format={(kg) => String(kgToInput(kg, units))}
                parse={parseDecimal}
                onCommit={(n) => update({ targetWeightKg: n === null ? null : toKg(n, units) })}
              />
              <div className={styles.sheetSteps}>
                <StepButton label="Less weight" dir={-1} onStep={() => update({ targetWeightKg: stepWeightFrom(sets, index, -1, units) })} />
                <StepButton label="More weight" dir={1} onStep={() => update({ targetWeightKg: stepWeightFrom(sets, index, 1, units) })} />
              </div>
            </div>
          ) : null}
          {fields.includes('duration') ? (
            <div className={styles.sheetBox}>
              <span className={styles.sheetLabel} aria-hidden="true">Time (m:ss)</span>
              <NumberInput
                key={`duration-${set.id}`}
                label="Duration (m:ss)"
                inputMode="numeric"
                placeholder="m:ss"
                className={styles.sheetInput}
                value={set.targetDurationS}
                format={formatClock}
                parse={parseClock}
                onCommit={(n) => update({ targetDurationS: n })}
              />
            </div>
          ) : null}
          {fields.includes('distance') ? (
            <div className={styles.sheetBox}>
              <span className={styles.sheetLabel} aria-hidden="true">{distanceUnit}</span>
              <NumberInput
                key={`distance-${set.id}`}
                label={`Distance (${distanceUnit})`}
                inputMode="decimal"
                placeholder="–"
                className={styles.sheetInput}
                value={set.targetDistanceM}
                format={(m) => String(fromMeters(m, distanceUnit))}
                parse={parseDecimal}
                onCommit={(n) => update({ targetDistanceM: n === null ? null : toMeters(n, distanceUnit) })}
              />
            </div>
          ) : null}
        </div>

        {fields.includes('reps') ? (
          <div className={styles.sheetRow} role="group" aria-label="Quick reps">
            <span className={styles.sheetRowLabel} aria-hidden="true">Reps</span>
            {QUICK_REPS.map((n) => (
              <button
                key={n}
                type="button"
                className={styles.sheetChip}
                aria-label={`${n} reps`}
                aria-pressed={reps === n}
                onClick={() => setReps(n)}
              >
                {n}
              </button>
            ))}
          </div>
        ) : null}

        {showsRest ? (
          <div className={styles.sheetField}>
            <span className={styles.sheetLabel} aria-hidden="true">Rest after this set</span>
            <div className={styles.sheetSeg} role="group" aria-label="Rest after this set">
              {REST_PRESETS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={styles.sheetSegItem}
                  aria-label={`Rest ${formatClock(s)}`}
                  aria-pressed={set.restSeconds === s}
                  onClick={() => update({ restSeconds: s })}
                >
                  {formatClock(s)}
                </button>
              ))}
              <NumberInput
                key={`rest-${set.id}`}
                label="Rest (m:ss)"
                inputMode="numeric"
                placeholder="m:ss"
                className={styles.sheetRestInput}
                value={set.restSeconds}
                format={formatClock}
                parse={parseClock}
                onCommit={(n) => update({ restSeconds: n ?? 0 })}
              />
            </div>
          </div>
        ) : null}

        <div className={styles.sheetField}>
          <span className={styles.sheetLabel} aria-hidden="true">Set type</span>
          <div className={styles.sheetSeg} role="group" aria-label="Set type">
            {SET_KINDS.map((k) => {
              const disabled = k === 'D' && index === 0;
              return (
                <button
                  key={k}
                  type="button"
                  className={styles.sheetSegItem}
                  aria-pressed={k === kind}
                  disabled={disabled}
                  title={disabled ? 'A drop set follows the set above, so the first set can’t be one.' : undefined}
                  onClick={() => {
                    if (k !== kind) update(setKindPatch(k));
                  }}
                >
                  {k === 'D' ? 'Drop' : SET_KIND_NAMES[k]}
                </button>
              );
            })}
          </div>
        </div>

        {sets.length > 1 ? (
          <label className={styles.sheetApply}>
            <input type="checkbox" className={styles.checkbox} checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
            <span>Apply to all {sets.length} sets</span>
          </label>
        ) : null}

        <div className={styles.sheetActions}>
          <button
            type="button"
            className={cx(styles.smallButton, styles.sheetRemove)}
            disabled={sets.length <= 1}
            title={sets.length > 1 ? undefined : 'An exercise keeps at least one set'}
            onClick={() => {
              onRemove(set.id);
              onClose();
            }}
          >
            Remove set
          </button>
          <button type="button" className={styles.sheetDone} onClick={onClose} data-ph-capture-attribute-label="workout_sheet_done">
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
