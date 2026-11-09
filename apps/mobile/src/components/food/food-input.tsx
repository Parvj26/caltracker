import { useRef } from 'react';
import { TextInput, View, type HostInstance, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { useRevealOnFocus } from '@/components/ui/screen';
import { palette } from '@/theme/theme';

/** A bare text input for the food screens (styled by the caller) that keeps clear of the keyboard when focused. */
export function FoodInput({
  style,
  wrapStyle,
  onFocus,
  ...rest
}: TextInputProps & { testID: string; accessibilityLabel: string; style?: StyleProp<TextStyle>; wrapStyle?: StyleProp<ViewStyle> }) {
  const reveal = useRevealOnFocus();
  const ref = useRef<HostInstance>(null);
  return (
    <View ref={ref} style={wrapStyle}>
      <TextInput
        {...rest}
        placeholderTextColor={palette.inkMuted}
        onFocus={(e) => {
          reveal(ref);
          onFocus?.(e);
        }}
        style={style}
      />
    </View>
  );
}
