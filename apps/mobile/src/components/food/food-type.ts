// Text styles for the food screens, sized as in the approved mockups (food canvas, 2026-11-09).
import { StyleSheet, type TextStyle } from 'react-native';
import { fontFamilyFor } from '@/theme/fonts';
import { palette } from '@/theme/theme';

/** Bricolage at a weight and size, in ink. (The mockups' 600 uses the bundled 500 file.) */
export function font(weight: 500 | 700 | 800, size: number): TextStyle {
  return { fontFamily: fontFamilyFor('sans', weight), fontSize: size, color: palette.ink };
}

export const foodText = StyleSheet.create({
  title: font(800, 30),
  overline: { ...font(800, 13), textTransform: 'uppercase', letterSpacing: 0.6, color: palette.inkMuted },
  heading: font(800, 18),
  muted: { color: palette.inkMuted },
});

/** The mockups' hard ink shadow under lime cards and the main button. */
export const inkShadow = { shadowColor: palette.ink, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 0 } as const;
