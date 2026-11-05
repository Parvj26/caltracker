import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type HostInstance, type TextInputProps } from 'react-native';
import { buttonMinHeight } from '@caltracker/design-tokens';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { useRevealOnFocus } from './screen';

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

/** Error message: ink text with a magenta marker, so colour is never the only signal. */
export function ErrorText({ children, testID }: { children: string; testID?: string }) {
  const { text, space } = useTheme();
  return (
    <View testID={testID} accessibilityRole="alert" style={[styles.errorRow, { gap: space[2] }]}>
      <Text style={[text('sectionHeading'), styles.marker]} accessibilityElementsHidden importantForAccessibility="no">
        ⚠
      </Text>
      <Text style={[text('sectionHeading'), styles.errorText]}>{children}</Text>
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
