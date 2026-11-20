import { useEffect, useRef, useState, type ComponentRef, type Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type HostInstance, type TextInputProps } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { buttonMinHeight, tapTarget } from '@caltracker/design-tokens';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { useRevealOnFocus } from './screen';
import type { ErrorCode } from '@caltracker/shared';
import { errorTextContent, reportErrorShown } from '@/lib/error-shown';

type TextFieldProps = TextInputProps & {
  label: string;
  testID: string;
  /** Short help under the field, e.g. "At least 8 characters". */
  hint?: string;
  /** The field's error, shown under it in red with ⚠ (UI rules §9.6). */
  error?: ErrorCode | null | undefined;
  /** A password: hidden, with a show/hide eye in the field (`eyeTestID` names the eye). */
  password?: boolean;
  eyeTestID?: string;
  ref?: Ref<TextFieldHandle>;
};

/** What a TextField's ref points at (the input), e.g. to move focus to it on Return. */
export type TextFieldHandle = ComponentRef<typeof TextInput>;

/** Labelled input. The label is visible and is also the input's accessibility label. */
export function TextField({ label, hint, testID, style, onFocus, onBlur, error, password = false, eyeTestID, ref, ...rest }: TextFieldProps) {
  const { text, device, radius, space } = useTheme();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const reveal = useRevealOnFocus();
  const wrapRef = useRef<HostInstance>(null);
  return (
    <View ref={wrapRef} style={{ gap: space[2] }}>
      <Text style={text('sectionHeading')}>{label}</Text>
      <View style={styles.inputRow}>
      <TextInput
        {...rest}
        ref={ref}
        secureTextEntry={password ? !shown : rest.secureTextEntry}
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={error ? errorTextContent(error) : hint}
        aria-invalid={error ? true : undefined}
        placeholderTextColor={palette.inkMuted}
        onFocus={(e) => {
          setFocused(true);
          reveal(wrapRef);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          text('body'),
          styles.input,
          {
            minHeight: buttonMinHeight[device],
            borderRadius: radius.input,
            paddingHorizontal: space[3.5],
            paddingVertical: space[3],
          },
          focused && styles.focused,
          error ? styles.invalid : null,
          password ? { paddingRight: tapTarget.min + space[1] } : null,
          style,
        ]}
      />
      {password ? (
        <Pressable
          testID={eyeTestID ?? `${testID}-eye`}
          onPress={() => setShown((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={shown ? 'Hide password' : 'Show password'}
          hitSlop={4}
          style={({ pressed }) => [styles.eye, pressed && { opacity: pressedOpacity }]}
        >
          <EyeIcon off={shown} />
        </Pressable>
      ) : null}
      </View>
      {error ? <FieldError code={error} testID={`${testID}-error`} /> : null}
      {hint ? <Text style={text('caption')}>{hint}</Text> : null}
    </View>
  );
}

/** The error under a field: ⚠ and the message in the danger colour, counted like every shown error. */
function FieldError({ code, testID }: { code: ErrorCode; testID: string }) {
  const { text, space } = useTheme();
  useEffect(() => {
    reportErrorShown(code);
  }, [code]);
  return (
    <View testID={testID} style={[styles.errorRow, { gap: space[1] }]} accessibilityLiveRegion="polite">
      <Text style={[text('sectionHeading'), styles.fieldError]} accessibilityElementsHidden importantForAccessibility="no">
        ⚠
      </Text>
      <Text style={[text('sectionHeading'), styles.fieldError, styles.errorText]}>{errorTextContent(code)}</Text>
    </View>
  );
}

/** An eye (show the password), or a crossed-out eye (hide it). */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <Circle cx={12} cy={12} r={3} />
      {off ? <Path d="M4 4l16 16" /> : null}
    </Svg>
  );
}

/**
 * Error message: ink text with a magenta marker, so colour is never the only signal. `code` (from the shared error
 * list) is sent with error_shown; the text shown is `children` (fixed copy only, never a raw server message) or the
 * code's catalogue message. The only place that may use accessibilityRole="alert" (lint enforces it).
 */
export function ErrorText({ code, children, testID }: { code: ErrorCode; children?: string | undefined; testID?: string }) {
  const { text, space } = useTheme();
  const shown = errorTextContent(code, children);
  // Count the error (never its text) each time a new message shows.
  useEffect(() => {
    reportErrorShown(code);
  }, [code, shown]);
  return (
    <View testID={testID} accessibilityRole="alert" style={[styles.errorRow, { gap: space[2] }]}>
      <Text style={[text('sectionHeading'), styles.marker]} accessibilityElementsHidden importantForAccessibility="no">
        ⚠
      </Text>
      <Text style={[text('sectionHeading'), styles.errorText]}>{shown}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: palette.surface, borderWidth: 2, borderColor: 'transparent' },
  focused: { borderColor: palette.ink, backgroundColor: palette.bg },
  invalid: { borderColor: palette.danger },
  inputRow: { justifyContent: 'center' },
  eye: { position: 'absolute', right: 2, width: tapTarget.min, height: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  fieldError: { color: palette.dangerDeep, fontSize: 14 },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start' },
  marker: { color: palette.magenta },
  errorText: { flex: 1 },
});
