import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Keyboard, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, pressedOpacity, swipeDeleteWidth, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** A drag past this many points, or a flick, leaves the row open. */
const OPEN_AT = swipeDeleteWidth / 2;
const FLICK = 0.5;
/** Horizontal movement beyond this (and clearly more than vertical) is a swipe, not a scroll or a tap. */
const SLOP = 10;

/** The one row that is open, if any. Opening a row closes it; scrolling and the keyboard close it too. */
let openRow: { close: () => void } | null = null;

/** Closes the open row (the list calls this when it starts to scroll). */
export function closeOpenSwipeRow(): void {
  openRow?.close();
}

/**
 * Swipe the row left to reveal a Delete button behind it; swipe right (or tap Delete) to close.
 * Plain React Native (PanResponder + Animated): the project has no gesture-handler. The ⋯ button on the row is
 * the way in for anyone who can't swipe. Only one row is open at a time.
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
  const x = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const [revealed, setRevealed] = useState(false);
  // A fast double tap on Delete must remove once.
  const firedRef = useRef(false);
  const me = useRef<{ close: () => void }>({ close: () => undefined }).current;

  const settle = useMemo(
    () => (open: boolean) => {
      openRef.current = open;
      if (open) {
        if (openRow && openRow !== me) openRow.close();
        openRow = me;
        firedRef.current = false;
        setRevealed(true);
      } else if (openRow === me) {
        openRow = null;
      }
      Animated.timing(x, { toValue: open ? -swipeDeleteWidth : 0, duration: 160, useNativeDriver: true }).start(() => {
        if (!openRef.current) setRevealed(false);
      });
    },
    [x, me],
  );
  me.close = () => settle(false);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Capture, so a Pressable or input under the finger can't keep a sideways drag from reaching the row.
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          enabled && Math.abs(g.dx) > SLOP && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          x.stopAnimation();
          setRevealed(true);
        },
        onPanResponderMove: (_e, g) => {
          const start = openRef.current ? -swipeDeleteWidth : 0;
          x.setValue(Math.max(-swipeDeleteWidth, Math.min(0, start + g.dx)));
        },
        onPanResponderRelease: (_e, g) => {
          const start = openRef.current ? -swipeDeleteWidth : 0;
          const at = start + g.dx;
          settle(g.vx < -FLICK ? true : g.vx > FLICK ? false : at < -OPEN_AT);
        },
        onPanResponderTerminate: () => settle(openRef.current),
      }),
    [x, settle, enabled],
  );

  // The keyboard opening closes an open row; a row that goes away (a deleted set) leaves nothing behind.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardWillShow', () => {
      if (openRef.current) settle(false);
    });
    return () => {
      sub.remove();
      x.stopAnimation();
      if (openRow === me) openRow = null;
    };
  }, [settle, x, me]);

  if (!enabled) return <View>{children}</View>;

  return (
    <View>
      {revealed ? (
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
            style={({ pressed }) => [styles.delete, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={[text('sectionHeading'), styles.deleteText]}>Delete</Text>
          </Pressable>
        </View>
      ) : null}
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  behind: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: palette.magentaDeep,
    overflow: 'hidden',
  },
  delete: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: white },
});
