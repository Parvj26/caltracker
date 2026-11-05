import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type HostInstance,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { contentMaxWidth, palette, space } from '@/theme/theme';

const PAD = space[6];
/** Room left above a focused field, so its label stays visible. */
const ABOVE_FOCUSED = space[4];

type RevealField = (field: RefObject<HostInstance | null>) => void;
const RevealContext = createContext<RevealField>(() => undefined);

/** Lets a field ask the surrounding Screen to scroll it into view when it gains focus. */
export function useRevealOnFocus(): RevealField {
  return useContext(RevealContext);
}

/**
 * Screen frame: safe area, white background, 16 pt side gutter, keyboard avoidance.
 * Content scrolls, so large Dynamic Type sizes reflow instead of being cut off. A focused field is
 * scrolled near the top, so the next field stays visible above the keyboard.
 */
export function Screen({
  children,
  centred = false,
  inTabs = false,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  centred?: boolean;
  /** Inside the tab bar, which already keeps clear of the home indicator. */
  inTabs?: boolean;
  /** Pull to refresh, when both are given. */
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  // The bottom inset is room inside the scrolling content, not a fixed strip under it, so content scrolls under
  // the home indicator instead of being cut off by a white band, and still clears it at the end.
  const bottomInset = useSafeAreaInsets().bottom;
  const columnRef = useRef<HostInstance>(null);
  const focused = useRef<RefObject<HostInstance | null> | null>(null);

  const scrollTo = useCallback((field: RefObject<HostInstance | null>) => {
    const column = columnRef.current;
    if (!field.current || !column) return;
    field.current.measureLayout(column, (_x, y) => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y + PAD - ABOVE_FOCUSED), animated: true });
    });
  }, []);

  const reveal = useCallback<RevealField>(
    (field) => {
      focused.current = field;
      scrollTo(field);
    },
    [scrollTo],
  );

  // The keyboard shrinks the scroll area after focus; scroll again once it is fully shown.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => focused.current && scrollTo(focused.current));
    const hide = Keyboard.addListener('keyboardDidHide', () => (focused.current = null));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scrollTo]);

  const value = useMemo(() => reveal, [reveal]);

  return (
    <RevealContext.Provider value={value}>
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            ref={scrollRef}
            style={styles.fill}
            contentContainerStyle={[
              styles.content,
              !inTabs && { paddingBottom: PAD + bottomInset },
              centred && styles.centred,
            ]}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              onRefresh ? (
                <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={palette.ink} />
              ) : undefined
            }
          >
            <View ref={columnRef} style={styles.column}>
              {children}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </RevealContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: space[4], paddingVertical: PAD },
  centred: { justifyContent: 'center' },
  column: { width: '100%', maxWidth: contentMaxWidth, gap: space[6] },
});
