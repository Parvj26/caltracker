import { Link, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { buttonBase, borderWidth, buttonMinHeight, pressDepth, tapTarget } from '@caltracker/design-tokens';
import { palette, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'finish';

/** Tracks the iOS/Android "Reduce Motion" setting. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

const FACE: Record<ButtonVariant, { fill: string; base: string | null; label: string }> = {
  primary: { fill: palette.ink, base: palette.lime, label: white },
  secondary: { fill: palette.bg, base: null, label: palette.ink },
  // White on magenta passes contrast only as large bold text, so the finish label is at least 19 pt.
  finish: { fill: palette.magenta, base: palette.magentaDeep, label: white },
};

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  testID?: string;
  disabled?: boolean;
  /** Announced as busy while true (and disabled). */
  busy?: boolean;
};

/**
 * Chunky button. Primary and finish sit on a 4 pt coloured base and sink 2 pt when pressed
 * (they fade instead when Reduce Motion is on).
 */
export function Button({ title, onPress, variant = 'primary', testID, disabled = false, busy = false }: ButtonProps) {
  const { text, device, radius } = useTheme();
  const reduceMotion = useReduceMotion();
  const face = FACE[variant];
  const off = disabled || busy;
  const label = text('button');
  const fontSize = variant === 'finish' ? Math.max(19, label.fontSize ?? 0) : label.fontSize;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      style={[styles.wrap, { paddingBottom: face.base ? buttonBase : 0 }, off && styles.disabled]}
    >
      {({ pressed }) => (
        <>
          {face.base ? (
            <View style={[styles.base, { backgroundColor: face.base, borderRadius: radius.button }]} />
          ) : null}
          <View
            style={[
              styles.face,
              {
                minHeight: buttonMinHeight[device],
                backgroundColor: face.fill,
                borderRadius: radius.button,
              },
              variant === 'secondary' && styles.secondary,
              pressed && !off && (reduceMotion ? styles.faded : { transform: [{ translateY: pressDepth }] }),
            ]}
          >
            <Text style={[label, { color: face.label, fontSize }, styles.centre]}>{title}</Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

type TextButtonProps = {
  title: string;
  testID?: string;
} & ({ href: Href; replace?: boolean; onPress?: never } | { onPress: () => void; href?: never; replace?: never });

/** Ink, underlined text that acts as a link or a quiet button. At least 44 pt tall to tap. */
export function TextButton({ title, testID, href, replace, onPress }: TextButtonProps) {
  const { text } = useTheme();
  const body = (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole={href ? 'link' : 'button'}
      hitSlop={4}
      style={({ pressed }) => [styles.textButton, pressed && styles.faded]}
    >
      <Text style={[text('body'), styles.underline]}>{title}</Text>
    </Pressable>
  );
  return href ? (
    <Link href={href} replace={replace} asChild>
      {body}
    </Link>
  ) : (
    body
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  base: { position: 'absolute', left: 0, right: 0, bottom: 0, top: buttonBase },
  face: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 12 },
  secondary: { borderWidth: borderWidth.secondaryButton, borderColor: palette.ink },
  centre: { textAlign: 'center' },
  disabled: { opacity: 0.7 },
  faded: { opacity: 0.75 },
  textButton: { minHeight: tapTarget.min, justifyContent: 'center', alignSelf: 'center', paddingHorizontal: 8 },
  underline: { textDecorationLine: 'underline', textAlign: 'center' },
});
