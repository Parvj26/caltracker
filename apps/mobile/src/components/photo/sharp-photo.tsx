import { useEffect, useState } from 'react';
import { Image, PixelRatio, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { photoSourceFor, type PhotoSize } from '@caltracker/shared';
import { palette } from '@/theme/theme';

/**
 * A private photo shown whole (never cropped) at exactly `size` points. When the screen needs more pixels than the
 * 320 px thumbnail has, the full photo (1600 px long edge) is drawn, with the thumbnail blurred underneath until it
 * has loaded; stretching the thumbnail is what made photos blurry. Small previews keep using the thumbnail.
 * React Native's own Image is used (the app has no expo-image): the box is the photo's shape, so `contain` draws it
 * at the box size, never shrunk then stretched.
 */
export function SharpPhoto({
  full,
  thumb,
  size,
  radius = 0,
  testID,
  style,
}: {
  full: string | undefined;
  thumb: string | undefined;
  size: PhotoSize;
  radius?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const wantsFull = photoSourceFor(size, PixelRatio.get()) === 'full';
  // Until the full photo's link is there (or for a photo still on the phone), the thumbnail stands in.
  const main = wantsFull ? (full ?? thumb) : (thumb ?? full);
  const placeholder = wantsFull && full ? thumb : undefined;
  const [loaded, setLoaded] = useState<string | null>(null);
  const showPlaceholder = placeholder !== undefined && loaded !== main;
  return (
    <View
      style={[styles.frame, { width: size.width, height: size.height, borderRadius: radius }, style]}
      testID={testID}
    >
      {showPlaceholder ? (
        <Image source={{ uri: placeholder }} style={StyleSheet.absoluteFill} resizeMode="contain" blurRadius={6} accessibilityIgnoresInvertColors />
      ) : null}
      {main ? (
        <Image
          source={{ uri: main }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onLoad={() => setLoaded(main)}
          accessibilityIgnoresInvertColors
          testID={testID ? `${testID}-${main === full ? 'full' : 'thumb'}` : undefined}
        />
      ) : null}
    </View>
  );
}

// Natural sizes by storage path (a signed link changes, the file does not), so a bubble keeps its shape on re-render.
const sizes = new Map<string, PhotoSize>();

/**
 * The natural size of a photo whose size is not stored (chat photos): read from the image once (the thumbnail has the
 * same shape and is quicker), then remembered by `key`. `null` until known.
 */
export function useNaturalSize(key: string, uri: string | undefined): PhotoSize | null {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (sizes.has(key) || !uri) return;
    let alive = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (!(width > 0 && height > 0)) return;
        sizes.set(key, { width, height });
        if (alive) rerender((n) => n + 1);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [key, uri]);
  return sizes.get(key) ?? null;
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: palette.bg },
});
