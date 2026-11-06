import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { palette, pressedOpacity, swipeDeleteWidth, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** Let go past this many points and the row stays open. */
const OPEN_AT = swipeDeleteWidth / 2;

/** The one row that is open, if any. Opening a row closes it; scrolling and the keyboard close it too. */
let openRow: { close: () => void } | null = null;

/** Closes the open row (the list calls this when it starts to scroll). */
export function closeOpenSwipeRow(): void {
  openRow?.close();
}

/**
 * Swipe the row left to reveal a Delete button beside it; swipe right (or tap Delete) to close.
 * The row is a small horizontal native ScrollView that snaps shut or open. (A JS PanResponder never saw the drag
 * inside the Edit sets sheet: the sheet's own drag took it.) The ⋯ button on the row is the way in for anyone who
 * can't swipe. Only one row is open at a time.
 */
export function SwipeToDelete({
  children,
  onDelete,
  testID,
  label,
  enabled = true,
}: {
  children: ReactNode;
  onDelete: () => void;
  /** Test id of the revealed Delete button. */
  testID: string;
  /** Accessible name of the button, e.g. "Delete set 2". */
  label: string;
  /** False when the set can't be removed (the only set of an exercise): the row then doesn't swipe at all. */
  enabled?: boolean;
}) {
  const { text, radius } = useTheme();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [width, setWidth] = useState(0);
  const openRef = useRef(false);
  // Drawn state: the Delete button is hidden from screen readers (and tests) while the row is shut.
  const [open, setOpen] = useState(false);
  // A fast double tap on Delete must remove once.
  const firedRef = useRef(false);
  const me = useRef<{ close: () => void }>({ close: () => undefined }).current;

  const settle = (next: boolean) => {
    openRef.current = next;
    setOpen(next);
    if (next) {
      if (openRow && openRow !== me) openRow.close();
      openRow = me;
      firedRef.current = false;
    } else if (openRow === me) {
      openRow = null;
    }
    scroll.current?.scrollTo({ x: next ? swipeDeleteWidth : 0, animated: true });
  };
  me.close = () => settle(false);

  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.x > OPEN_AT;
    if (next !== openRef.current || (next && openRow !== me)) settle(next);
  };

  // The keyboard opening closes an open row; a row that goes away (a deleted set) leaves nothing behind.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardWillShow', () => {
      if (openRef.current) me.close();
    });
    return () => {
      sub.remove();
      if (openRow === me) openRow = null;
    };
  }, [me]);

  if (!enabled) return <View>{children}</View>;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={scroll}
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        snapToOffsets={[0, swipeDeleteWidth]}
        snapToEnd={false}
        decelerationRate="fast"
        directionalLockEnabled
        keyboardShouldPersistTaps="handled"
        onScrollEndDrag={onEnd}
        onMomentumScrollEnd={onEnd}
      >
        {/* Until the row is measured it takes its natural width, so nothing jumps on first draw. */}
        <View style={width > 0 ? { width } : undefined}>{children}</View>
        <View style={[styles.behind, { width: swipeDeleteWidth, borderRadius: radius.input }]}>
          <Pressable
            testID={testID}
            onPress={() => {
              if (firedRef.current) return;
              firedRef.current = true;
              settle(false);
              onDelete();
            }}
            accessibilityRole="button"
            accessibilityLabel={label}
            // Off screen until the row is swiped open: screen readers use the ⋯ menu's Remove set instead.
            accessibilityElementsHidden={!open}
            importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
            style={({ pressed }) => [styles.delete, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={[text('sectionHeading'), styles.deleteText]}>Delete</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  behind: {
    backgroundColor: palette.magentaDeep,
    overflow: 'hidden',
  },
  delete: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: white },
});
