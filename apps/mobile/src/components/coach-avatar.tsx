import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { initials } from '@/lib/workouts';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * The coach's photo, or their initials when there is no photo (or it cannot load, e.g. offline). `ring` draws an ink
 * outline that wide; large avatars (80 pt and up) get initials sized to the circle.
 */
export function CoachAvatar({ name, url, size = 52, ring = 0 }: { name: string; url: string | null; size?: number; ring?: number }) {
  const { text } = useTheme();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = url !== null && failedUrl !== url;
  const box = { width: size, height: size, borderRadius: size / 2 };
  const outline = ring > 0 ? { borderWidth: ring, borderColor: palette.ink } : null;
  const inner = { width: size - 2 * ring, height: size - 2 * ring, borderRadius: (size - 2 * ring) / 2 };

  return (
    <View
      style={[styles.box, box, outline]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="coach-avatar"
    >
      {showPhoto ? (
        <Image source={{ uri: url }} style={inner} onError={() => setFailedUrl(url)} accessible={false} />
      ) : (
        <Text style={size >= 80 ? [text('screenTitle'), { fontSize: Math.round(size * 0.35) }] : text('sectionHeading')}>{initials(name)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', backgroundColor: palette.pink, overflow: 'hidden' },
});
