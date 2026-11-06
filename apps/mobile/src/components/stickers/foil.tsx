import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useReduceMotion } from '@/components/ui';
import { palette, white } from '@/theme/theme';

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The shiny shimmer: bands of light that sweep across the sticker, drawn as layered views with an animated
 * position (no extra library). Laid over the art; it ignores touches. Holds still when Reduce Motion is on.
 */
export function Foil({ size }: { size: number }) {
  const reduce = useReduceMotion();
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
      sweep.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1400, easing: smooth, useNativeDriver: true }),
        Animated.delay(500),
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, sweep]);

  const x = sweep.interpolate({ inputRange: [0, 1], outputRange: [-size, size] });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]} testID="foil">
      <Animated.View style={[styles.bands, { width: size * 0.5, transform: [{ translateX: x }, { rotate: '20deg' }] }]}>
        <View style={[styles.band, { backgroundColor: palette.pink, opacity: 0.35 }]} />
        <View style={[styles.band, { backgroundColor: white, opacity: 0.5, flex: 0.5 }]} />
        <View style={[styles.band, { backgroundColor: palette.lime, opacity: 0.3 }]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  bands: { position: 'absolute', top: -40, bottom: -40, left: 0, flexDirection: 'row' },
  band: { flex: 1 },
});
