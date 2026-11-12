// Small sheets of the logging flow: Finish workout?, last time's numbers, and what a set tag means.
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tapTarget } from '@caltracker/design-tokens';
import { FEELINGS, type Feeling } from '@caltracker/shared';
import { Button, TextButton, TextField } from '@/components/ui';
import { sheetDraft, type FinishModel, type SubstituteCard } from '@/lib/log-flow-model';
import { contentMaxWidth, palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const NOTE_MAX = 1900;

/** A sheet from the bottom with a title, some lines and an OK. Tapping outside closes it. */
export function InfoSheet({
  title,
  lines,
  testID,
  onClose,
}: {
  /** Null hides it. */
  title: string | null;
  lines: string[];
  testID: string;
  onClose: () => void;
}) {
  const { text, space, radius } = useTheme();
  return (
    <Modal visible={title !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]}>
        <View testID={testID} style={[styles.column, { gap: space[3], padding: space[4.5] }]}>
          <Text style={text('screenTitle')} accessibilityRole="header">
            {title ?? ''}
          </Text>
          {lines.map((l, i) => (
            <Text key={i} style={text('body')}>
              {l}
            </Text>
          ))}
          <Button testID={`${testID}-ok`} title="OK" variant="secondary" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/** "Which one are you doing?": the planned exercise or the coach's substitute. Tapping a card chooses it. */
export function SubstituteSheet({
  context,
  cards,
  onChoose,
  onClose,
}: {
  /** "Resistance Training · Superset 3"; null hides the sheet. */
  context: string | null;
  cards: SubstituteCard[];
  onChoose: (substituteId: string | null) => void;
  onClose: () => void;
}) {
  const { text, space, radius } = useTheme();
  return (
    <Modal visible={context !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <SafeAreaView edges={['bottom']} style={[styles.sheet, { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]}>
        <View testID="substitute-sheet" accessibilityViewIsModal style={[styles.column, { gap: space[3], padding: space[4.5] }]}>
          <Text style={text('caption')}>{context ?? ''}</Text>
          <Text style={text('screenTitle')} accessibilityRole="header">
            Which one are you doing?
          </Text>
          <Text style={text('body')}>Your coach added a substitute for when the machine is taken.</Text>
          {cards.map((c, i) => (
            <Pressable
              key={c.substituteId ?? 'planned'}
              testID={c.substituteId === null ? 'sub-option-planned' : `sub-option-${i}`}
              onPress={() => (c.chosen ? onClose() : onChoose(c.substituteId))}
              accessibilityRole="button"
              accessibilityState={{ selected: c.chosen }}
              accessibilityLabel={`${c.kind}: ${c.name}, ${c.summary}${c.chosen ? '. Doing this one' : ''}`}
              style={({ pressed }) => [
                styles.card,
                { borderRadius: radius.card, padding: space[3], gap: space[1] / 2 },
                c.chosen && styles.cardChosen,
                pressed && { opacity: pressedOpacity },
              ]}
            >
              <Text style={[text('caption'), styles.ink]}>{c.chosen ? `${c.kind} · doing this one` : c.kind}</Text>
              <Text style={[text('sectionHeading'), styles.ink]}>{`${c.name}${c.chosen ? '' : '  ›'}`}</Text>
              <Text style={[text('caption'), styles.ink]}>{c.summary}</Text>
              {c.note ? <Text style={[text('caption'), styles.ink]}>{`Coach: ${c.note}`}</Text> : null}
            </Pressable>
          ))}
          <Text style={text('caption')}>Your coach will see which one you did.</Text>
          <TextButton testID="substitute-cancel" title="Cancel" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/**
 * Finish workout?: how many sets are done (unticked ones are saved as not done), How did it feel?, a note for the
 * coach, then Keep going or Finish. With nothing ticked it can only be discarded.
 */
export function FinishSheet({
  visible,
  model,
  initialFeel,
  initialNote,
  busy,
  onKeepGoing,
  onSaveDraft,
  onFinish,
  onDiscard,
}: {
  visible: boolean;
  model: FinishModel;
  initialFeel: Feeling | null;
  initialNote: string;
  busy: boolean;
  /** Keep going, or the sheet closed: the feeling and note so far, to keep as a draft. */
  onKeepGoing: (feel: Feeling | null, note: string) => void;
  /** The note box was left: save the feeling and note so far, keeping the sheet open. */
  onSaveDraft: (feel: Feeling | null, note: string) => void;
  onFinish: (feel: Feeling | null, note: string) => void;
  onDiscard: () => void;
}) {
  const { text, space, radius } = useTheme();
  const [feel, setFeel] = useState<Feeling | null>(initialFeel);
  const [note, setNote] = useState(initialNote);
  // Start from the saved note only as the sheet opens: a change of the saved note while it is open (the save on
  // blur, a sync) must not overwrite what the client is typing.
  const wasVisible = useRef(false);
  useEffect(() => {
    const next = sheetDraft({ wasVisible: wasVisible.current, visible, draft: { feel, note }, saved: { feel: initialFeel, note: initialNote } });
    wasVisible.current = visible;
    if (next.feel !== feel) setFeel(next.feel);
    if (next.note !== note) setNote(next.note);
    // Only the opening matters; feel and note are read, not watched.
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onKeepGoing(feel, note)}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        <ScrollView testID="finish-sheet" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={[styles.column, { padding: space[4], gap: space[4] }]}>
          <Text style={text('screenTitle')} accessibilityRole="header">
            Finish workout?
          </Text>
          <Text testID="finish-count" style={text('body')}>
            {[model.headline, model.unticked].filter(Boolean).join(' ')}
          </Text>
          {model.noneDone ? (
            <>
              <Text testID="finish-none" style={text('sectionHeading')}>
                Complete at least one set to finish.
              </Text>
              <Button testID="finish-keep-going" title="Keep going" onPress={() => onKeepGoing(feel, note)} />
              <TextButton testID="finish-discard" title="Discard workout" onPress={onDiscard} />
            </>
          ) : (
            <>
              <View style={{ gap: space[2] }} accessibilityRole="radiogroup" accessibilityLabel="How did it feel?">
                <Text style={text('sectionHeading')}>How did it feel?</Text>
                <View style={[styles.feelings, { gap: space[2] }]}>
                  {FEELINGS.map((f) => {
                    const on = feel === f;
                    return (
                      <Pressable
                        key={f}
                        testID={`feel-${f}`}
                        onPress={() => setFeel(on ? null : f)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on, checked: on }}
                        style={({ pressed }) => [
                          styles.feel,
                          { borderRadius: radius.pill, paddingHorizontal: space[3] },
                          on && styles.feelOn,
                          pressed && { opacity: pressedOpacity },
                        ]}
                      >
                        <Text style={[text('sectionHeading'), on ? styles.onInk : styles.ink]}>{f}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <TextField
                label="Note for your coach (optional)"
                testID="finish-note"
                value={note}
                onChangeText={setNote}
                onBlur={() => onSaveDraft(feel, note)}
                multiline
                maxLength={NOTE_MAX}
              />
              <View style={[styles.actions, { gap: space[3] }]}>
                <View style={styles.flex}>
                  <Button testID="finish-keep-going" variant="secondary" title="Keep going" onPress={() => onKeepGoing(feel, note)} />
                </View>
                <View style={styles.flex}>
                  <Button testID="finish-confirm" variant="finish" title="Finish" busy={busy} ph-label="log_finish_confirm" onPress={() => onFinish(feel, note)} />
                </View>
              </View>
              <Text style={text('caption')}>Then your stickers and personal bests.</Text>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
  backdrop: { flex: 1, backgroundColor: palette.inkMuted },
  sheet: { backgroundColor: palette.bg },
  feelings: { flexDirection: 'row', flexWrap: 'wrap' },
  feel: { minHeight: tapTarget.min, justifyContent: 'center', backgroundColor: palette.surface },
  feelOn: { backgroundColor: palette.ink },
  ink: { color: palette.ink },
  onInk: { color: palette.bg },
  actions: { flexDirection: 'row' },
  card: { minHeight: tapTarget.logging, backgroundColor: palette.surface },
  cardChosen: { backgroundColor: palette.lime },
  flex: { flex: 1 },
});
