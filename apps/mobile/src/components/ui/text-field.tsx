import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type HostInstance, type TextInputProps } from 'react-native';
import { buttonMinHeight } from '@caltracker/design-tokens';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { useRevealOnFocus } from './screen';
import type { ErrorCode } from '@caltracker/shared';
import { errorTextContent, reportErrorShown } from '@/lib/error-shown';

type TextFieldProps = TextInputProps & {
  label: string;
  testID: string;
  /** Short help under the field, e.g. "At least 8 characters". */
  hint?: string;
};

/** Labelled input. The label is visible and is also the input's accessibility label. */
export function TextField({ label, hint, testID, style, onFocus, onBlur, ...rest }: TextFieldProps) {
  const { text, device, radius, space } = useTheme();
  const [focused, setFocused] = useState(false);
  const reveal = useRevealOnFocus();
  const wrapRef = useRef<HostInstance>(null);
  return (
    <View ref={wrapRef} style={{ gap: space[2] }}>
      <Text style={text('sectionHeading')}>{label}</Text>
      <TextInput
        {...rest}
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={hint}
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
          style,
        ]}
      />
      {hint ? <Text style={text('caption')}>{hint}</Text> : null}
    </View>
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
  errorRow: { flexDirection: 'row', alignItems: 'flex-start' },
  marker: { color: palette.magenta },
  errorText: { flex: 1 },
});
