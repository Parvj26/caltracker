// The pages inside a section: a straight exercise, a superset (round by round) and a pick-one group (approved Logger
// and Superset boards, 2026-11-19). They only draw the page model (log-flow-model.ts); every edit goes back to the
// screen through the handlers. readOnly (the coach logs the workout): the same pages with the coach's numbers, and
// no control that edits.
import { useState, type ReactNode, type Ref } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type HostInstance } from 'react-native';
import type { Units } from '@caltracker/shared';
import { Button } from '@/components/ui';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { logControls } from '@/lib/coach-watch';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import {
  isRoundOpen,
  toggleRound,
  type ExerciseModel,
  type FoldState,
  type OptionPageModel,
  type RoundModel,
  type RowModel,
  type StraightPageModel,
  type SupersetPageModel,
} from '@/lib/log-flow-model';
import { ChevronIcon } from '@/components/ui/icons';
import { LockIcon } from '@/components/settings/icons';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { ExerciseDemo, ExerciseTools, Tool } from './exercise-tools';
import { AddSetButton, SetRowLine, SetTable, type TableHandlers } from './set-table';
import { fontFamilyFor } from '@/theme/fonts';
import { ExerciseBadges } from '@/components/exercise-badges';

export type PageHandlers = {
  table: (ex: ExerciseModel) => TableHandlers;
  onAddSet: (ex: ExerciseModel) => void;
  /** "+ Add round" on a superset: tops every exercise up to the longest, then one more set each. */
  onAddRound: (model: SupersetPageModel) => void;
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
 * The coach's substitute: "Machine taken? Switch to X" before choosing; "Instead of Y · Switch" after (approved LT1
 * board). Switching stays possible until a set is ticked.
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
        <Text style={[text('body'), styles.ink, styles.flex]} accessibilityLabel={`Doing the substitute, instead of the planned ${sub.doingInsteadOf}`}>
          {'Instead of '}
          <Text style={styles.bold}>{sub.doingInsteadOf}</Text>
        </Text>
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

/** The 64 pt demo thumbnail, the name and "Rest 1:30". Tapping the thumbnail opens the exercise sheet. */
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
          <Text testID={`rest-line-${idKey}`} style={[text('body'), styles.soft]} accessibilityLabel={`${ex.restLine} between sets`}>
            {ex.restLine}
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
  const switcher = (
    <View style={{ gap: space[2] }}>
      <View style={[styles.rowCentre, { gap: space[2] }]}>
        <Text style={[text('caption'), styles.overline]}>Pick one</Text>
        {model.locked ? (
          <View
            testID={`option-locked-${common.page}`}
            accessibilityLabel="Locked: the pick can’t change once a set is ticked"
            style={[styles.rowCentre, styles.lockedChip, { borderRadius: radius.pill, paddingHorizontal: space[2], gap: 4 }]}
          >
            <LockIcon />
            <Text style={[text('caption'), styles.ink, styles.bold]}>Locked</Text>
          </View>
        ) : null}
      </View>
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
      {model.locked || !can.tick ? null : (
        <Text testID={`option-line-${common.page}`} style={[text('caption'), styles.soft]}>
          Locks after your first set
        </Text>
      )}
    </View>
  );
  return <SingleExercise {...common} ex={model.exercise} rows={model.rows} between={switcher} />;
}

/**
 * A superset (approved Superset boards SS1–SS5): "Superset B · Back to back, then rest 1:30", the exercises as slim
 * rows (photo with its B1 tag, Last, Swap, ···), then the rounds. Done rounds fold into one line (tap to open, tap again
 * to fold); a partly done one says "· 1 left" and stays open; the current round is a card with the set after the last
 * tick outlined; rounds to come are faded. "+ Add round", then Mark all.
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
  const [fold, setFold] = useState<FoldState>({});
  // At large text sizes Swap and ··· go under the name, so a name never breaks mid-word.
  const stacked = useWindowDimensions().fontScale > STACK_ABOVE_SCALE;
  let order = 0;
  const rowsOf = (round: RoundModel, faded: boolean) =>
    round.entries.map((entry) => {
      const ex = model.exercises[entry.exerciseIndex];
      const idKey = keyOf(page, ex);
      return entry.rows.map((row) => (
        <SetRowLine
          key={row.setId}
          row={row}
          idKey={idKey}
          unitBelow
          rowLabel={ex.label ?? ''}
          faded={faded}
          showMore={can.more}
          exerciseLabel={`${ex.label ?? ''} ${ex.name}`.trim()}
          units={units}
          readOnly={readOnly}
          recent={row.setId === recentSetId}
          page={page}
          order={order++}
          handlers={handlers.table(ex)}
        />
      ));
    });
  const rest = (round: RoundModel) =>
    round.restLine ? (
      <Text testID={`round-rest-${page}-${round.round}`} style={[text('caption'), styles.soft]}>
        {round.restLine}
      </Text>
    ) : null;
  return (
    <View style={{ gap: space[3] }}>
      <CoachNote coachName={coachName} note={coachNote} />
      <View style={[styles.titleRow, { columnGap: space[3] }]}>
        <Text ref={headingRef} testID={`superset-heading-${page}`} style={text('screenTitle')} accessibilityRole="header">
          {model.heading}
        </Text>
        <Text testID={`superset-intro-${page}`} style={[text('body'), styles.soft]}>
          {model.intro}
        </Text>
      </View>
      <View>
        {model.exercises.map((ex, i) => {
          const idKey = keyOf(page, ex);
          const help = model.helpAfter[ex.exerciseIndex];
          return (
            <View key={ex.logExerciseId} style={[i > 0 && styles.divider, { paddingVertical: space[2], gap: space[1] }]}>
              <View testID={`exercise-row-${idKey}`} style={[styles.slimRow, stacked && styles.slimStacked, { gap: space[2] }]}>
                <View style={[styles.rowCentre, stacked ? styles.slimFull : styles.slimMain, { gap: space[3] }]}>
                  <ExerciseDemo
                    name={ex.name}
                    detail={details[ex.exerciseId]}
                    testID={`demo-${idKey}`}
                    tag={ex.label}
                    size={SLIM_PHOTO}
                    onPress={() => handlers.onInfo(ex)}
                  />
                  <View style={[styles.flex, { gap: 2 }]}>
                    <Text testID={`exercise-name-${idKey}`} style={[text('sectionHeading'), styles.slimName]}>
                      {ex.name}
                    </Text>
                    {ex.lastLine || ex.badges.length > 0 ? (
                      <View style={[styles.rowCentre, styles.wrap, { gap: space[2] }]}>
                        {ex.lastLine ? (
                          <Text testID={`last-line-${idKey}`} style={[text('caption'), styles.soft]}>
                            {ex.lastLine}
                          </Text>
                        ) : null}
                        {/* The chip only: its one-line explanation shows once on the page, below. */}
                        <ExerciseBadges badges={ex.badges} help={null} testID={`badges-${idKey}`} />
                      </View>
                    ) : null}
                  </View>
                </View>
                {can.swap || can.more ? (
                  <View style={[styles.rowCentre, { gap: space[2] }]}>
                    {can.swap ? (
                      <Tool
                        title="Swap"
                        label={ex.substitute !== null && !ex.substitute.locked ? `Substitute available for ${ex.name}` : `Swap ${ex.name}`}
                        testID={`swap-${idKey}`}
                        dotted={ex.substitute !== null && !ex.substitute.locked}
                        onPress={() => handlers.onSwap(ex)}
                      />
                    ) : null}
                    {can.more ? <Tool title="···" label={`More for ${ex.name}`} testID={`more-${idKey}`} onPress={() => handlers.onMore(ex)} /> : null}
                  </View>
                ) : null}
              </View>
              {help ? (
                <Text testID={`badges-help-${page}`} style={[text('caption'), styles.soft]}>
                  {help}
                </Text>
              ) : null}
              <Notes ex={ex} idKey={idKey} />
              <SubstituteStrip ex={ex} idKey={idKey} readOnly={readOnly} onPress={() => handlers.onSubstitute(ex)} />
            </View>
          );
        })}
      </View>
      {model.rounds.map((round) => {
        if (round.kind === 'current' || round.kind === 'future') {
          const current = round.kind === 'current';
          return (
            <View
              key={round.round}
              testID={`round-${page}-${round.round}`}
              style={[current && [styles.card, { borderRadius: radius.card, padding: 2, paddingTop: space[1] }], { gap: space[1] }]}
            >
              <Text
                testID={`round-heading-${page}-${round.round}`}
                style={[text('sectionHeading'), { paddingHorizontal: space[2], paddingTop: space[1] }, !current && styles.soft]}
                accessibilityRole="header"
                accessibilityLabel={`${round.heading}${current ? ', current round' : ''}`}
              >
                {round.heading}
              </Text>
              {rowsOf(round, !current)}
              {rest(round)}
            </View>
          );
        }
        const open = isRoundOpen(fold, round);
        const done = round.kind === 'done';
        return (
          <View key={round.round} style={[styles.foldBox, { borderRadius: radius.card }]}>
            <Pressable
              testID={`round-${page}-${round.round}`}
              onPress={() => setFold((f) => toggleRound(f, round))}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${round.title}, ${done ? `done: ${round.summary.replace(/\+↓/g, 'drop')}` : round.summary}. ${open ? 'Hide' : 'Show'} its sets.`}
              style={({ pressed }) => [styles.foldLine, { paddingHorizontal: space[3], gap: space[2.5] }, pressed && { opacity: pressedOpacity }]}
            >
              <View style={[styles.dot, done ? styles.dotDone : styles.dotOpen]}>{done ? <Text style={styles.dotMark}>✓</Text> : null}</View>
              <Text testID={`round-heading-${page}-${round.round}`} style={text('sectionHeading')}>
                {round.title}
              </Text>
              <Text testID={`round-summary-${page}-${round.round}`} numberOfLines={1} ellipsizeMode="tail" style={[text('caption'), styles.soft, styles.flex]}>
                {done ? round.summary : `· ${round.summary}`}
              </Text>
              <ChevronIcon direction={open ? 'up' : 'down'} size={18} />
            </Pressable>
            {open ? (
              <View style={[styles.foldBody, { borderRadius: radius.card, padding: 2, gap: space[1] }]}>
                {rowsOf(round, false)}
                {rest(round)}
              </View>
            ) : null}
          </View>
        );
      })}
      {can.addSet ? <AddSetButton testID={`add-round-${page}`} title="+ Add round" onPress={() => handlers.onAddRound(model)} /> : null}
      <MarkAll page={page} title="Mark all" onPress={can.markAll ? onMarkAll : null} />
    </View>
  );
}

/** Above this text size a superset's exercise row puts Swap and ··· on a line of their own. */
const STACK_ABOVE_SCALE = 1.3;

/** The photo on a superset's exercise row. */
const SLIM_PHOTO = 48;

const DOT = 26;

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
  wrap: { flexWrap: 'wrap' },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between' },
  slimRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' },
  slimName: { fontSize: 16 },
  slimStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  slimFull: { alignSelf: 'stretch' },
  slimMain: { flexGrow: 1, flexShrink: 1, flexBasis: 200 },
  divider: { borderTopWidth: 1, borderTopColor: palette.border },
  card: { borderWidth: borderWidth.secondaryButton, borderColor: palette.border },
  lockedChip: { backgroundColor: palette.surface, minHeight: 26 },
  foldBox: { backgroundColor: palette.surface, overflow: 'hidden' },
  foldLine: { flexDirection: 'row', alignItems: 'center', minHeight: tapTarget.logging },
  foldBody: { backgroundColor: palette.bg, margin: 2, marginTop: 0 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: palette.ink },
  dotOpen: { borderWidth: borderWidth.card, borderColor: palette.borderStrong },
  dotMark: { color: white, fontFamily: fontFamilyFor('sans', 800), fontSize: 14 },
});
