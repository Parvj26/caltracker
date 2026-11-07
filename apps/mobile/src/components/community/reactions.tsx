import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { useReduceMotion } from '@/components/ui';
import { setReaction, type ReactionTarget } from '@/lib/community-api';
import { palette, pressedOpacity, stickerTheme } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

/**
 * Reactions on one post or comment: the rows as shown (my taps show at once and roll back on an error), the picker's
 * open state, and the bar and picker to render. `openPicker` is also what a long-press on the post or comment calls.
 */
export function useReactions(opts: { target: ReactionTarget; rows: ReactionRow[]; me: string; onChanged: () => void }) {
  const { target, rows, me, onChanged } = opts;
  const [shown, setShown] = useState(rows);
  const [seen, setSeen] = useState(rows);
  // The server's answer wins once the screen reloads.
  if (seen !== rows) {
    setSeen(rows);
    setShown(rows);
  }
  const [pickerOpen, setPickerOpen] = useState(false);

  const toggle = (key: ReactionKey) => {
    const change = reactionTap(shown, { userId: me, name: 'You' }, key, new Date().toISOString());
    setShown((rows) => applyReactionChange(rows, change));
    void setReaction(target, key, change.op === 'add')
      .then(onChanged)
      .catch((e: unknown) => {
        // Undo only this tap: other taps made since then stay.
        setShown((rows) => applyReactionChange(rows, invertReactionChange(change)));
        Alert.alert(errorText(e));
      });
  };

  const mine = new Set(shown.filter((r) => r.userId === me).map((r) => r.reaction));
  return {
    openPicker: () => setPickerOpen(true),
    bar: <ReactionBar rows={shown} me={me} onToggle={toggle} onAdd={() => setPickerOpen(true)} />,
    picker: (
      <ReactionPicker
        visible={pickerOpen}
        mine={mine}
        onPick={(key) => {
          setPickerOpen(false);
          toggle(key);
        }}
        onClose={() => setPickerOpen(false)}
      />
    ),
  };
}

/** Each used reaction with its count (highlighted when I reacted), and a button that opens the picker. */
function ReactionBar({ rows, me, onToggle, onAdd }: { rows: ReactionRow[]; me: string; onToggle: (key: ReactionKey) => void; onAdd: () => void }) {
  const { text, space, radius } = useTheme();
  const summary = summarizeReactions(rows, me);
  return (
    <View style={[styles.bar, { gap: space[2] }]} testID="reaction-bar">
      {summary.map((s) => (
        <View key={s.key} style={[styles.chip, { borderRadius: radius.pill }, s.mine && styles.mine]} testID={`reaction-${s.key}`}>
          <Pressable
            testID={`reaction-${s.key}-toggle`}
            accessibilityRole="button"
            accessibilityState={{ selected: s.mine }}
            accessibilityLabel={reactionButtonLabel(s)}
            onPress={() => onToggle(s.key)}
            style={({ pressed }) => [styles.chipPart, { paddingLeft: space[3], paddingRight: space[1] }, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={text('body')}>{s.emoji}</Text>
          </Pressable>
          <Pressable
            testID={`reaction-${s.key}-count`}
            accessibilityRole="button"
            accessibilityLabel={whoReactedLabel(s)}
            onPress={() => Alert.alert(`${s.emoji} Reacted with ${s.label}`, s.names.join('\n'))}
            style={({ pressed }) => [styles.chipPart, { paddingLeft: space[1], paddingRight: space[3] }, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={text('sectionHeading')}>{s.count}</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        testID="reaction-add"
        accessibilityRole="button"
        accessibilityLabel="Add a reaction"
        accessibilityHint="Or press and hold the post or comment"
        onPress={onAdd}
        style={({ pressed }) => [styles.chip, styles.chipPart, { borderRadius: radius.pill, paddingHorizontal: space[3] }, pressed && { opacity: pressedOpacity }]}
      >
        <Text style={text('sectionHeading')}>☺+</Text>
      </Pressable>
    </View>
  );
}

/** The six choices in a sheet. Choosing one I already used takes it back. */
function ReactionPicker({
  visible,
  mine,
  onPick,
  onClose,
}: {
  visible: boolean;
  mine: ReadonlySet<ReactionKey>;
  onPick: (key: ReactionKey) => void;
  onClose: () => void;
}) {
  const { text, space, radius } = useTheme();
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { padding: space[6], gap: space[3], borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]}>
        <Text style={text('sectionHeading')} accessibilityRole="header">
          React
        </Text>
        <View style={[styles.choices, { gap: space[2] }]}>
          {REACTIONS.map((r) => {
            const used = mine.has(r.key);
            return (
              <Pressable
                key={r.key}
                testID={`react-${r.key}`}
                accessibilityRole="button"
                accessibilityState={{ selected: used }}
                accessibilityLabel={used ? `Remove your ${r.label} reaction` : `React with ${r.label}`}
                onPress={() => onPick(r.key)}
                style={({ pressed }) => [styles.choice, { borderRadius: radius.pill }, used && styles.mine, pressed && { opacity: pressedOpacity }]}
              >
                <Text style={styles.choiceEmoji}>{r.emoji}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          testID="react-cancel"
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.cancel, { paddingVertical: space[3] }, pressed && { opacity: pressedOpacity }]}
        >
          <Text style={text('sectionHeading')}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border, overflow: 'hidden' },
  chipPart: { minHeight: 44, minWidth: 22, justifyContent: 'center' },
  mine: { backgroundColor: palette.pink, borderColor: palette.ink },
  scrim: { flex: 1, backgroundColor: palette.ink, opacity: stickerTheme.scrimOpacity },
  sheet: { backgroundColor: palette.bg },
  choices: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  choice: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface },
  choiceEmoji: { fontSize: 28 },
  cancel: { minHeight: 44, justifyContent: 'center' },
});
