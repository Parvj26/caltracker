'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MAX_CHOICE_OPTIONS, MAX_SUBSTITUTES } from '@caltracker/shared';
import type { Units, WorkoutBlockDoc } from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import { Button, ErrorText } from '@/components/ui';
import { AddSectionMenu } from './add-section-menu';
import {
  AddSetButton,
  ExerciseNote,
  ExerciseOptions,
  ExerciseSets,
  Substitutes,
  SwapName,
  cardHasErrors,
  restState,
  type BlockActions,
} from './block-editor';
import { BlockMenu, MoveToDialog, type MenuItem } from './block-menu';
import { Icon } from './icons';
import { MeasurementChips } from './measurements-menu';
import { SupersetSwitch, type Link } from './superset-switch';
import { useSheetKeyboardInset } from './use-keyboard-offset';
import styles from './builder.module.css';
import { openLayer } from '@/lib/open-layer';

/** One exercise in the list: a straight exercise, one exercise of a superset, or a whole pick-one group. */
export type Card = {
  key: string;
  block: WorkoutBlockDoc;
  /** The exercise's place in its superset; undefined for a straight exercise or a pick-one group. */
  member?: number;
  badge: string;
  title: string;
  line: string;
  /** The switch to the next card, or null (the last card of a section, or next to a pick-one group). */
  link: Link | null;
};

/**
 * iPhone: one compact row per exercise (badge, name, "3 × 12 @ 35 lb · rest 1:30", ›); a tap opens its editor.
 * Wide screens use the same row in the left pane: `selected` makes it a pressed/unpressed button that shows the
 * exercise in the right pane (no chevron, no window).
 */
export function PhoneRow({ card, hasErrors, onOpen, selected }: { card: Card; hasErrors: boolean; onOpen: () => void; selected?: boolean }) {
  const pane = selected !== undefined;
  return (
    <button
      type="button"
      className={cx(styles.phoneRow, pane && styles.paneRow)}
      data-superset={card.member !== undefined ? '' : undefined}
      data-card-id={card.key}
      aria-haspopup={pane ? undefined : 'dialog'}
      aria-pressed={pane ? selected : undefined}
      aria-label={`${card.title}: ${card.line}`}
      onClick={onOpen}
      data-ph-capture-attribute-label={pane ? 'workout_pane_row' : 'workout_phone_row'}
    >
      <span className={styles.blockNumber} data-superset={card.member !== undefined ? '' : undefined} aria-hidden="true">{card.badge}</span>
      <span className={styles.foldText}>
        <span className={styles.foldTitle}>{card.title}</span>
        <span className={styles.foldLine}>{card.line}</span>
        {hasErrors ? <span className={styles.foldError}>Needs a fix</span> : null}
      </span>
      {pane ? null : (
        <span className={styles.phoneRowChevron} aria-hidden="true">
          <Icon name="chevron" size={20} />
        </span>
      )}
    </button>
  );
}

export function PhoneLink({ link }: { link: Link }) {
  return <SupersetSwitch link={link} variant="icon" />;
}

/** A full-screen window on the phone (a <dialog>, so focus stays inside), kept above the keyboard. */
function FullScreen({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useSheetKeyboardInset(ref);
  useEffect(() => {
    const d = ref.current;
    if (d) openLayer(d);
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.phoneEditor}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

type EditorProps = {
  card: Card;
  /** 0-based place among all cards, and how many there are. */
  place: number;
  count: number;
  onGo: (delta: -1 | 1) => void;
  onClose: () => void;
  units: Units;
  errors: ReadonlyMap<string, string[]>;
  actions: BlockActions;
  restOff: ReadonlySet<string>;
  /** "Move to…": the block's places in its section and the sections it can go to. */
  places: Parameters<typeof MoveToDialog>[0]['places'];
  sectionTargets: Parameters<typeof MoveToDialog>[0]['sections'];
};

/**
 * iPhone: one exercise (or pick-one group) on its own screen. ‹ goes back to the list, ↑ ↓ to the exercise before or
 * after; Measurements are toggle chips; each set is a card with − / + beside its boxes; Tempo, each side and the note
 * fold away. "+ Set" and Done stay at the bottom.
 */
export function PhoneExerciseEditor({ card, place, count, onGo, onClose, units, errors, actions, restOff, places, sectionTargets }: EditorProps) {
  const [moving, setMoving] = useState(false);
  const optionsId = useId();
  const { block, member } = card;
  const choice = member === undefined && block.kind === 'choice';
  const shown = member !== undefined ? [member] : block.exercises.map((_, i) => i);
  const first = block.exercises[shown[0]!]!;
  const remove = member !== undefined ? () => actions.onRemoveExercise(first.id) : actions.onRemoveBlock;
  const menuItems: MenuItem[] = [
    ...(!choice ? [{ label: 'Swap exercise', onSelect: () => actions.onSwap(first.id) }] : []),
    ...(!choice
      ? [{ label: 'Add substitute', disabled: first.substitutes.length >= MAX_SUBSTITUTES, onSelect: () => actions.onAddSubstitute(first.id) }]
      : []),
    { label: member !== undefined ? 'Move superset to…' : 'Move to…', disabled: places.length < 2 && sectionTargets.length === 0, onSelect: () => setMoving(true) },
    {
      label: choice ? 'Delete pick-one group' : 'Delete exercise',
      danger: true,
      onSelect: () => {
        remove();
        onClose();
      },
    },
  ];

  return (
    <FullScreen label={card.title} onClose={onClose}>
      <div className={styles.phoneEditorHead}>
        <div className={styles.phoneEditorNav}>
          <button type="button" className={styles.phoneBack} aria-label="Back to the workout" onClick={onClose}>
            <Icon name="chevron" size={24} />
          </button>
          <span className={styles.phoneEditorCount}>
            Exercise {place + 1} of {count}
          </span>
          <button type="button" className={styles.sheetArrow} aria-label="Previous exercise" disabled={place === 0} onClick={() => onGo(-1)}>
            <span aria-hidden="true">↑</span>
          </button>
          <button type="button" className={styles.sheetArrow} aria-label="Next exercise" disabled={place >= count - 1} onClick={() => onGo(1)}>
            <span aria-hidden="true">↓</span>
          </button>
        </div>
        <div className={styles.phoneEditorTitle}>
          <span className={styles.blockNumber} data-superset={card.member !== undefined ? '' : undefined} aria-hidden="true">{card.badge}</span>
          <h2 className={styles.phoneEditorName}>
            {choice ? card.title : <SwapName name={first.exerciseName} onSwap={() => actions.onSwap(first.id)} />}
          </h2>
          <BlockMenu name={card.title} items={menuItems} />
        </div>
        {!choice ? (
          <MeasurementChips
            trackingType={first.trackingType}
            exerciseName={first.exerciseName}
            onToggle={(m) => actions.onToggleMeasurement(first.id, m)}
            rest={restState(block, shown[0]!, restOff)}
            onToggleRest={(on) => actions.onToggleRest(first.id, on)}
          />
        ) : null}
      </div>
      {moving ? <MoveToDialog name={member !== undefined ? 'the superset' : card.title} places={places} sections={sectionTargets} onClose={() => setMoving(false)} /> : null}

      <div className={styles.phoneEditorBody}>
        {(member === undefined || member === 0) && (errors.get(`block:${block.id}`) ?? []).map((m) => (
          <ErrorText key={m} code="workout_fields_invalid" safe={false}>
            {m}
          </ErrorText>
        ))}
        {shown.map((ei) => {
          const ex = block.exercises[ei]!;
          return (
            <div key={ex.id} className={styles.phoneExercise}>
              {choice ? (
                <div className={styles.exerciseHeader}>
                  <h3 className={styles.exerciseName}>
                    <SwapName name={ex.exerciseName} onSwap={() => actions.onSwap(ex.id)} />
                  </h3>
                  <button type="button" className={styles.smallButton} aria-label={`Remove ${ex.exerciseName}`} onClick={() => actions.onRemoveExercise(ex.id)}>
                    Remove
                  </button>
                  <MeasurementChips
                    trackingType={ex.trackingType}
                    exerciseName={ex.exerciseName}
                    onToggle={(m) => actions.onToggleMeasurement(ex.id, m)}
                    rest={restState(block, ei, restOff)}
                    onToggleRest={(on) => actions.onToggleRest(ex.id, on)}
                  />
                </div>
              ) : null}
              <ExerciseSets block={block} ei={ei} units={units} errors={errors} actions={actions} restOff={restOff} stacked />
              {restState(block, ei, restOff) === false ? (
                <p className={styles.caption}>Rest is off: the client&apos;s phone shows no rest after this exercise.</p>
              ) : null}
              {choice ? <AddSetButton label={`Add a set to ${ex.exerciseName}`} onClick={() => actions.onAddSet(ex.id)} /> : null}
              <details className={styles.phoneDetails} open={(errors.get(`tempo:${ex.id}`)?.length ?? 0) > 0 || undefined}>
                <summary className={styles.phoneDetailsSummary} id={`${optionsId}-${ei}`}>
                  Tempo, each side, note
                </summary>
                <div className={styles.phoneDetailsBody}>
                  <ExerciseOptions
                    exercise={ex}
                    errors={errors.get(`tempo:${ex.id}`) ?? []}
                    onChange={(patch) => actions.onExerciseOptions(ex.id, patch)}
                  />
                  <ExerciseNote exercise={ex} onChange={(note) => actions.onExerciseNote(ex.id, note)} />
                </div>
              </details>
              <Substitutes block={block} ei={ei} units={units} errors={errors} actions={actions} restOff={restOff} stacked />
            </div>
          );
        })}
        {choice ? (
          <button type="button" className={styles.smallButton} disabled={block.exercises.length >= MAX_CHOICE_OPTIONS} onClick={actions.onAddOption}>
            + Add option
          </button>
        ) : null}
      </div>

      <div className={styles.phoneEditorBar}>
        {!choice ? (
          <button type="button" className={styles.phoneAddSet} aria-label={`Add a set to ${first.exerciseName}`} onClick={() => actions.onAddSet(first.id)} data-ph-capture-attribute-label="workout_add_set">
            + Set <span className={styles.addSetHint}>copies last set</span>
          </button>
        ) : null}
        <Button className={styles.phoneDoneButton} onClick={onClose} phSafe>
          Done
        </Button>
      </div>
    </FullScreen>
  );
}

/** Whether a card's exercises (or its block, for its first card) have a message from the last save. */
export function phoneCardHasErrors(card: Card, errors: ReadonlyMap<string, string[]>): boolean {
  const exs = card.member !== undefined ? [card.block.exercises[card.member]!] : card.block.exercises;
  return cardHasErrors(card.block, exs, errors, card.member === undefined || card.member === 0);
}

/** The phone's "More" sheet: Reorder, + Pick one and + Section, as three big rows. */
export function MoreSheet({
  onReorder,
  onPickOne,
  full,
  sectionsFull,
  onAddSection,
  onClose,
}: {
  onReorder: () => void;
  onPickOne: () => void;
  full: boolean;
  sectionsFull: boolean;
  onAddSection: (name: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useSheetKeyboardInset(ref);
  useEffect(() => {
    const d = ref.current;
    if (d) openLayer(d);
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-label="More"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.sheetInner}>
        <span className={styles.sheetGrab} aria-hidden="true" />
        <button type="button" className={styles.moreRow} onClick={onReorder}>
          <Icon name="reorder" />
          <span className={styles.moreText}>
            <strong>Reorder</strong>
            <span className={styles.caption}>Change the order of exercises</span>
          </span>
        </button>
        <button type="button" className={styles.moreRow} disabled={full} onClick={onPickOne}>
          <Icon name="pickOne" />
          <span className={styles.moreText}>
            <strong>+ Pick one</strong>
            <span className={styles.caption}>Client chooses one of a few options</span>
          </span>
        </button>
        <AddSectionMenu
          full={sectionsFull}
          onAdd={(name) => {
            onAddSection(name);
            onClose();
          }}
          trigger={
            <>
              <Icon name="section" />
              <span className={styles.moreText}>
                <strong>+ Section</strong>
                <span className={styles.caption}>Warm-Up, Main, Finisher…</span>
              </span>
            </>
          }
          triggerClassName={cx(styles.moreRow)}
        />
      </div>
    </dialog>
  );
}
