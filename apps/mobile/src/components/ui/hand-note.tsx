import { StyleSheet, Text } from 'react-native';
import { useTheme } from '@/theme/use-theme';

/** Handwritten aside (Caveat, magenta, tilted). Real text, so screen readers read it. One per screen at most. */
export function HandNote({ children }: { children: string }) {
  const { text } = useTheme();
  return <Text style={[text('hand'), styles.note]}>{children}</Text>;
}

const styles = StyleSheet.create({
  note: { alignSelf: 'flex-start', transformOrigin: 'left center' },
});
