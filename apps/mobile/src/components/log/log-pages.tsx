// The pages inside a section: a straight exercise, a superset (round by round) and a pick-one group (approved Logger
// and Superset boards, 2026-11-19). They only draw the page model (log-flow-model.ts); every edit goes back to the
// screen through the handlers. readOnly (the coach logs the workout): the same pages with the coach's numbers, and
// no control that edits.
import { useState, type ReactNode, type Ref } from 'react';
import { Pressable, StyleSheet, Text, View, type HostInstance } from 'react-native';
import type { Units } from '@caltracker/shared';
import { Button } from '@/components/ui';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { logControls } from '@/lib/coach-watch';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import type { ExerciseModel, OptionPageModel, RowModel, StraightPageModel, SupersetPageModel } from '@/lib/log-flow-model';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { ExerciseDemo, ExerciseTools } from './exercise-tools';
import { AddSetButton, SetRowLine, SetTable, type TableHandlers } from './set-table';
import { fontFamilyFor } from '@/theme/fonts';
import { ExerciseBadges } from '@/components/exercise-badges';

export type PageHandlers = {
  table: (ex: ExerciseModel) => TableHandlers;
  onAddSet: (ex: ExerciseModel) => void;
  onInfo: (ex: ExerciseModel) => void;
  onMessage: (ex: ExerciseModel) => void;
  onSwap: (ex: ExerciseModel) => void;
  /** "Which one are you doing?": the planned exercise or the coach's substitute. */
  onSubstitute: (ex: ExerciseModel) => void;
  onMore: (ex: ExerciseModel) => void;
  /** The pick-one switch: choose this option (allowed until one of its sets is ticked). */
  onChoose: (blockId: string, logExerciseId: string) => void;
};

type Common = {
  page: number;
  units: Units;
  details: Record<string, ExerciseDetail>;
  handlers: PageHandlers;
  /** The page's heading: VoiceOver moves here when the page comes on screen. */
  headingRef: Ref<HostInstance>;
  /** Mark all (or Mark all rounds); null hides it (everything ticked). */
  onMarkAll: (() => void) | null;
  /** The coach logs this workout: nothing on the page edits it; photos and info still open. */
  readOnly: boolean;
  /** Read only: the set the coach ticked last, outlined. */
  recentSetId: string | null;
  /** The coach's first name ("Note for Luis"), or null. */
  coachName: string | null;
  /** The coach's note on the workout: shown on the first page only. */
  coachNote: string | null;
};

/** Mark all sits at the end of the page, away from the Next button. */
function MarkAll({ page, title, onPress }: { page: number; title: string; onPress: (() => void) | null }) {
  const { space } = useTheme();
  if (!onPress) return null;
  return (
    <View style={{ marginTop: space[2] }}>
      <Button variant="secondary" size="logging" testID={`mark-all-${page}`} title={title} onPress={onPress} />
    </View>
  );
}

const keyOf = (page: number, ex: ExerciseModel) => `${page}-${ex.exerciseIndex}`;

/** "Luis: Go a bit heavier on the squats today" on the first page (approved Logger board). */
function CoachNote({ coachName, note }: { coachName: string | null; note: string | null }) {
  const { logText: text, space, radius } = useTheme();
  if (!note) return null;
  return (
    <Text testID="log-coach-note" style={[text('body'), styles.note, { borderRadius: radius.input, padding: space[3] }]}>
      <Text style={styles.bold}>{`${coachName ?? 'Your coach'}: `}</Text>
      {note}
    </Text>
  );
}

/**
 * The coach's substitute: "Machine taken? Switch to X" before choosing; "Doing the substitute (planned: Y) · Switch"
 * after. Switching stays possible until a set is ticked.
 */
function SubstituteStrip({ ex, idKey, readOnly, onPress }: { ex: ExerciseModel; idKey: string; readOnly: boolean; onPress: () => void }) {
  const { logText: text, space, radius } = useTheme();
  const sub = ex.substitute;
  const canSwitch = logControls(readOnly).substituteSwitch;
  if (!sub || ((sub.locked || !canSwitch) && sub.doingInsteadOf === null)) return null;
  const box = [text('body'), styles.strip, { borderRadius: radius.input, padding: space[3] }];
  if (sub.doingInsteadOf !== null) {
    return (
      <View testID={`substitute-doing-${idKey}`} style={[styles.doing, box]}>
        <Text style={[text('body'), styles.ink, styles.flex]}>{`Doing the substitute (planned: ${sub.doingInsteadOf})`}</Text>
        {sub.locked || !canSwitch ? null : (
          <Pressable
            testID={`substitute-switch-${idKey}`}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel="Switch exercise"
            style={styles.switch}
          >
            <Text style={[text('sectionHeading'), styles.link]}>Switch</Text>
          </Pressable>
        )}
      </View>
    );
  }
  return (
    <Text testID={`substitute-strip-${idKey}`} onPress={onPress} accessibilityRole="button" style={box}>
      <Text style={styles.bold}>Machine taken?</Text>
      {` Switch to ${sub.otherNames} ›`}
    </Text>
  );
}

/** Auto progression's suggestion and the client's own note for the coach. */
function Notes({ ex, idKey }: { ex: ExerciseModel; idKey: string }) {
  const { logText: text } = useTheme();
  return (
    <>
      {ex.progression ? (
        <Text testID={`progression-${idKey}`} style={text('caption')} accessibilityLabel={`Auto progression: ${ex.progression}`}>
          {ex.progression}
        </Text>
      ) : null}
      {ex.note ? (
        <Text testID={`exercise-note-${idKey}`} style={text('body')}>
          {`Note: ${ex.note}`}
        </Text>
      ) : null}
    </>
  );
}

/** The 64 pt demo thumbnail, the name and "Rest 1:30 between sets". Tapping the thumbnail opens the exercise sheet. */
function ExerciseHead({
  ex,
  idKey,
  details,
  headingRef,
  page,
  onInfo,
}: {
  ex: ExerciseModel;
  idKey: string;
  details: Record<string, ExerciseDetail>;
  headingRef: Ref<HostInstance>;
  page: number;
  onInfo: () => void;
}) {
  const { logText: text, space } = useTheme();
  return (
    <View style={[styles.rowCentre, { gap: space[3] }]}>
      <ExerciseDemo name={ex.name} detail={details[ex.exerciseId]} testID={`demo-${idKey}`} onPress={onInfo} />
      <View style={[styles.flex, { gap: 2 }]}>
        <Text ref={headingRef} testID={`exercise-name-${page}`} style={[text('screenTitle'), styles.name]} accessibilityRole="header">
          {ex.name}
        </Text>
        {ex.restLine ? (
          <Text testID={`rest-line-${idKey}`} style={[text('body'), styles.soft]}>
            {`${ex.restLine} between sets`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Demo, name, tools, then the set table. Shared by a straight exercise and a pick-one group. */
function SingleExercise({
  page,
  ex,
  rows,
  units,
  details,
  handlers,
  headingRef,
  onMarkAll,
  readOnly,
  recentSetId,
  coachName,
  coachNote,
  between,
}: Common & { ex: ExerciseModel; rows: RowModel[]; between?: ReactNode }) {
  const { space } = useTheme();
  const idKey = keyOf(page, ex);
  const can = logControls(readOnly);
  return (
    <View style={{ gap: space[3] }}>
      <CoachNote coachName={coachName} note={coachNote} />
      {between}
      <ExerciseHead ex={ex} idKey={idKey} details={details} headingRef={headingRef} page={page} onInfo={() => handlers.onInfo(ex)} />
      <ExerciseBadges badges={ex.badges} help={ex.badgeHelp} testID={`badges-${idKey}`} logging />
      <Notes ex={ex} idKey={idKey} />
      <ExerciseTools
        idKey={idKey}
        name={ex.name}
        coachName={coachName}
        hasSubstitute={ex.substitute !== null && !ex.substitute.locked}
        onMessage={can.message ? () => handlers.onMessage(ex) : null}
        onSwap={can.swap ? () => handlers.onSwap(ex) : null}
        onMore={can.more ? () => handlers.onMore(ex) : null}
      />
      <SubstituteStrip ex={ex} idKey={idKey} readOnly={readOnly} onPress={() => handlers.onSubstitute(ex)} />
      <SetTable
        rows={rows}
        idKey={idKey}
        units={units}
        page={page}
        readOnly={readOnly}
        recentSetId={recentSetId}
        handlers={handlers.table(ex)}
        onAddSet={!can.addSet ? null : () => handlers.onAddSet(ex)}
      />
      <MarkAll page={page} title="Mark all" onPress={can.markAll ? onMarkAll : null} />
    </View>
  );
}

export function StraightPage({ model, ...common }: Common & { model: StraightPageModel }) {
  return <SingleExercise {...common} ex={model.exercise} rows={model.rows} />;
}

/**
 * A pick-one group: a switch between its options (two side by side; more wrap), and only the chosen option's sets.
 * The first option shows until one is chosen; ticking a set picks it. Switching is allowed until a set is ticked.
 */
export function OptionPage({ model, ...common }: Common & { model: OptionPageModel }) {
  const { logText: text, space, radius } = useTheme();
  const can = logControls(common.readOnly);
  const chosen = model.choices.find((c) => c.chosen);
  const switcher = (
    <View style={{ gap: space[2] }}>
      <Text style={[text('caption'), styles.overline]}>Pick one</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Choose one"
        style={[styles.segments, { borderRadius: radius.input + 2, padding: 4, gap: 4 }]}
      >
        {model.choices.map((c, i) => {
          const blocked = !can.tick || (model.locked && !c.chosen);
          return (
            <Pressable
              key={c.logExerciseId}
              testID={`option-${common.page}-${i}`}
              disabled={blocked}
              onPress={() => (c.chosen ? undefined : common.handlers.onChoose(model.blockId, c.logExerciseId))}
              accessibilityRole="radio"
              accessibilityState={{ checked: c.chosen, disabled: blocked }}
              style={({ pressed }) => [
                styles.segment,
                { borderRadius: radius.input - 2, paddingHorizontal: space[2] },
                c.chosen && styles.segmentOn,
                blocked && !c.chosen && styles.segmentOff,
                pressed && { opacity: pressedOpacity },
              ]}
            >
              <Text style={[text('sectionHeading'), styles.segmentText, c.chosen && styles.bold]} numberOfLines={2}>
                {c.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text testID={`option-line-${common.page}`} style={[text('caption'), styles.soft]}>
        {model.locked
          ? `You’re doing ${chosen?.name ?? 'this one'}. It can’t be switched once a set is ticked.`
          : 'Only the chosen one’s sets show. Switch any time before you tick a set.'}
      </Text>
    </View>
  );
  return <SingleExercise {...common} ex={model.exercise} rows={model.rows} between={switcher} />;
}

/**
 * A superset (approved Superset board): A1 then A2 back to back, the rest after the round. Each exercise's demo and
 * tools show once at the top; rounds below, the done ones folded into one line (tap to show). Ticking A1 marks A2 as
 * next.
 */
export function SupersetPage({
  model,
  page,
  units,
  details,
  handlers,
  headingRef,
  onMarkAll,
  readOnly,
  recentSetId,
  coachName,
  coachNote,
}: Common & { model: SupersetPageModel }) {
  const { logText: text, space, radius } = useTheme();
  const can = logControls(readOnly);
  const [opened, setOpened] = useState<Set<number>>(() => new Set());
  const labels = model.exercises.map((e) => e.label ?? e.name);
  const rest = model.rounds.find((r) => r.restLine)?.restLine ?? null;
  let order = 0;
  return (
    <View style={{ gap: space[3] }}>
      <CoachNote coachName={coachName} note={coachNote} />
      <Text ref={headingRef} testID={`superset-heading-${page}`} style={text('screenTitle')} accessibilityRole="header">
        {model.heading}
      </Text>
      <Text style={[text('body'), styles.soft]}>
        {`Do ${labels.join(' then ')} back to back.${rest ? ` ${rest}.` : ''}`}
      </Text>
      {model.exercises.map((ex) => {
        const idKey = keyOf(page, ex);
        return (
          <View key={ex.logExerciseId} style={[styles.exerciseCard, { borderRadius: radius.card, padding: space[3], gap: space[2] }]}>
            <View style={[styles.rowCentre, { gap: space[2.5] }]}>
              <View style={[styles.badge, { borderRadius: radius.input - 2 }]}>
                <Text style={[text('sectionHeading'), styles.onInk]} maxFontSizeMultiplier={BADGE_MAX_SCALE}>
                  {ex.label}
                </Text>
              </View>
              {/* Name, then last time under it (side by side they squeeze each other at large text). */}
              <View style={styles.flex}>
                <Text testID={`exercise-name-${idKey}`} style={text('sectionHeading')}>
                  {ex.name}
                </Text>
                <Text style={[text('caption'), styles.soft]}>{ex.lastLine}</Text>
              </View>
            </View>
            <View style={[styles.rowCentre, { gap: space[3] }]}>
              <ExerciseDemo name={ex.name} detail={details[ex.exerciseId]} testID={`demo-${idKey}`} onPress={() => handlers.onInfo(ex)} />
              <View style={styles.flex}>
                <ExerciseTools
                  idKey={idKey}
                  name={ex.name}
                  coachName={coachName}
                  hasSubstitute={ex.substitute !== null && !ex.substitute.locked}
                  onMessage={null}
                  onSwap={can.swap ? () => handlers.onSwap(ex) : null}
                  onMore={can.more ? () => handlers.onMore(ex) : null}
                />
              </View>
            </View>
            <ExerciseBadges badges={ex.badges} help={ex.badgeHelp} testID={`badges-${idKey}`} logging />
            <Notes ex={ex} idKey={idKey} />
            <SubstituteStrip ex={ex} idKey={idKey} readOnly={readOnly} onPress={() => handlers.onSubstitute(ex)} />
          </View>
        );
      })}
      {model.rounds.map((round) => {
        const current = round.round === model.currentRound;
        const folded = round.done && !current && !opened.has(round.round);
        if (folded) {
          return (
            <Pressable
              key={round.round}
              testID={`round-${page}-${round.round}`}
              onPress={() => setOpened((o) => new Set(o).add(round.round))}
              accessibilityRole="button"
              accessibilityLabel={`${round.heading}. Show its sets.`}
              style={({ pressed }) => [styles.folded, { borderRadius: radius.input, paddingHorizontal: space[3] }, pressed && { opacity: pressedOpacity }]}
            >
              <Text testID={`round-heading-${page}-${round.round}`} style={[text('sectionHeading'), styles.flex]}>
                {round.heading}
              </Text>
              <Text style={[text('caption'), styles.soft]}>Show</Text>
            </Pressable>
          );
        }
        return (
          <View key={round.round} testID={`round-${page}-${round.round}`} style={{ gap: space[2] }}>
            <Text
              testID={`round-heading-${page}-${round.round}`}
              style={text('sectionHeading')}
              accessibilityRole="header"
              accessibilityLabel={`${round.heading}${current && !round.done ? ', current round' : ''}`}
            >
              {round.heading}
            </Text>
            {round.entries.map((entry) => {
              const ex = model.exercises[entry.exerciseIndex];
              const idKey = keyOf(page, ex);
              return entry.rows.map((row) => (
                <View key={row.setId} style={[styles.rowCentre, { gap: space[2] }]}>
                  <Text style={[text('caption'), styles.roundLabel]}>{ex.label}</Text>
                  <View style={styles.flex}>
                    <SetRowLine
                      row={row}
                      idKey={idKey}
                      unitBelow
                      exerciseLabel={`${ex.label ?? ''} ${ex.name}`.trim()}
                      units={units}
                      readOnly={readOnly}
                      recent={row.setId === recentSetId}
                      page={page}
                      order={order++}
                      handlers={handlers.table(ex)}
                    />
                  </View>
                </View>
              ));
            })}
            {round.restLine ? (
              <Text testID={`round-rest-${page}-${round.round}`} style={[text('caption'), styles.soft]}>
                {round.restLine}
              </Text>
            ) : null}
          </View>
        );
      })}
      {can.addSet ? (
        <View style={{ gap: space[1] }}>
          {model.exercises.map((ex) => (
            <AddSetButton
              key={ex.logExerciseId}
              testID={`add-set-${keyOf(page, ex)}`}
              title={`+ Add set to ${ex.label ?? ex.name}`}
              onPress={() => handlers.onAddSet(ex)}
            />
          ))}
        </View>
      ) : null}
      <MarkAll page={page} title="Mark all rounds" onPress={can.markAll ? onMarkAll : null} />
    </View>
  );
}

const BADGE = 34;
/** The A1 badge is a fixed square: its letters stop growing here. */
const BADGE_MAX_SCALE = 1.2;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontFamily: fontFamilyFor('sans', 800) },
  rowCentre: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 22 },
  soft: { color: palette.inkMuted },
  note: { backgroundColor: palette.drop, color: palette.ink, overflow: 'hidden' },
  overline: { color: palette.ink, fontFamily: fontFamilyFor('sans', 800), textTransform: 'uppercase', letterSpacing: 0.4 },
  strip: { backgroundColor: palette.tape, color: palette.ink, overflow: 'hidden' },
  doing: { flexDirection: 'row', alignItems: 'center' },
  ink: { color: palette.ink },
  onInk: { color: white, fontSize: 14 },
  link: { color: palette.ink, textDecorationLine: 'underline' },
  switch: { minWidth: tapTarget.min, minHeight: tapTarget.min, alignItems: 'flex-end', justifyContent: 'center' },
  segments: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: borderWidth.secondaryButton, borderColor: palette.borderStrong },
  segment: { flexGrow: 1, flexBasis: '45%', minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { borderWidth: borderWidth.card, borderColor: palette.ink, backgroundColor: palette.bg },
  segmentOff: { opacity: 0.4 },
  segmentText: { color: palette.ink, textAlign: 'center', fontSize: 15 },
  exerciseCard: { borderWidth: borderWidth.secondaryButton, borderColor: palette.border },
  badge: { width: BADGE, height: BADGE, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  folded: { flexDirection: 'row', alignItems: 'center', minHeight: tapTarget.min, backgroundColor: palette.surface },
  roundLabel: { width: 26, color: palette.ink, fontFamily: fontFamilyFor('sans', 800) },
});
