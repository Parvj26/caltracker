import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { initials } from '@/lib/workouts';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** The coach's photo, or their initials when there is no photo (or it cannot load, e.g. offline). */
export function CoachAvatar({ name, url, size = 52 }: { name: string; url: string | null; size?: number }) {
  const { text } = useTheme();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = url !== null && failedUrl !== url;
  const box = { width: size, height: size, borderRadius: size / 2 };

  return (
    <View
      style={[styles.box, box]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="coach-avatar"
    >
      {showPhoto ? (
        <Image source={{ uri: url }} style={box} onError={() => setFailedUrl(url)} accessible={false} />
      ) : (
        <Text style={text('sectionHeading')}>{initials(name)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', backgroundColor: palette.pink, overflow: 'hidden' },
});
