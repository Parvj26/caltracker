import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { radius, space, device } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { borderRadius: radius.card, padding: device === 'tablet' ? space[6] : space[4.5], gap: space[4] },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.bg, borderWidth: borderWidth.card, borderColor: palette.border },
});
