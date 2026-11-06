import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { useReduceMotion } from '@/components/ui';
import { stickerImage } from '@/lib/sticker-assets';
import { palette, stickerTheme } from '@/theme/theme';
import { Foil } from './foil';

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * A sticker's art. With `pop` it springs in over a pink burst; `shiny` lays the foil shimmer over it.
 * Decorative: the name is always read from the text beside it. The colours come from the theme tokens; the art itself is a generated image (stickerImage).
 */
export function Sticker({
  stickerKey,
  size,
  pop = false,
  shiny = false,
  variant = 'lg',
}: {
  stickerKey: string;
  size: number;
  pop?: boolean;
  shiny?: boolean;
  variant?: 'lg' | 'sm' | 'locked';
}) {
  const reduce = useReduceMotion();
  const scale = useRef(new Animated.Value(pop ? 0.2 : 1)).current;
  const burst = useRef(new Animated.Value(pop ? 0 : 1)).current;

  useEffect(() => {
    if (!pop) return;
    if (reduce) {
      scale.setValue(1);
      burst.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 90, useNativeDriver: true }),
      Animated.timing(burst, { toValue: 1, duration: 450, easing: easeOut, useNativeDriver: true }),
    ]).start();
  }, [pop, reduce, scale, burst]);

  const burstSize = size * stickerTheme.burstScale;
  return (
    <View style={{ width: burstSize, height: burstSize }} testID="sticker-art" accessible={false}>
      {pop ? (
        <Animated.View
          style={[
            styles.burst,
            {
              width: burstSize,
              height: burstSize,
              borderRadius: burstSize / 2,
              opacity: burst.interpolate({ inputRange: [0, 1], outputRange: [0, stickerTheme.burstOpacity] }),
              transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
            },
          ]}
        />
      ) : null}
      <Animated.View style={[styles.art, { transform: [{ scale }] }]}>
        <View style={{ width: size, height: size }}>
          <Image source={stickerImage(stickerKey, variant)} style={{ width: size, height: size }} resizeMode="contain" />
          {shiny ? <Foil size={size} /> : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  burst: { position: 'absolute', backgroundColor: palette.pink },
  art: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
