import { Image, StyleSheet, Text, View } from 'react-native';
import { initialsOf } from '@/lib/chat-format';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** The coach's photo, or their initials when there is no photo. */
export function CoachAvatar({ name, photoUrl, size = 44 }: { name: string | null; photoUrl: string | null; size?: number }) {
  const { text } = useTheme();
  const box = { width: size, height: size, borderRadius: size / 2 };
  return photoUrl ? (
    <Image source={{ uri: photoUrl }} style={box} accessibilityIgnoresInvertColors accessibilityLabel={name ? `${name}'s photo` : 'Coach photo'} />
  ) : (
    <View style={[styles.initials, box]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={text('sectionHeading')}>{initialsOf(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  initials: { backgroundColor: palette.pink, alignItems: 'center', justifyContent: 'center' },
});
