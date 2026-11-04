import BricolageGrotesque_500Medium from '@expo-google-fonts/bricolage-grotesque/500Medium/BricolageGrotesque_500Medium.ttf';
import BricolageGrotesque_700Bold from '@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf';
import BricolageGrotesque_800ExtraBold from '@expo-google-fonts/bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf';
import Caveat_700Bold from '@expo-google-fonts/caveat/700Bold/Caveat_700Bold.ttf';
import type { TypeStyle } from '@caltracker/design-tokens';

/**
 * The four bundled font files, keyed by the family name React Native uses.
 * Release builds embed them through the expo-font plugin (app.json); `useFonts` covers Expo Go and dev builds.
 * Files are imported by path so only these four weights are bundled.
 */
export const FONT_ASSETS = {
  BricolageGrotesque_500Medium,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
  Caveat_700Bold,
} as const;

export type FontFamilyName = keyof typeof FONT_ASSETS;

const SANS: Record<TypeStyle['weight'], FontFamilyName> = {
  500: 'BricolageGrotesque_500Medium',
  700: 'BricolageGrotesque_700Bold',
  800: 'BricolageGrotesque_800ExtraBold',
};

/** Caveat ships in one weight only (700), whatever weight is asked for. */
export function fontFamilyFor(family: TypeStyle['family'], weight: TypeStyle['weight']): FontFamilyName {
  return family === 'hand' ? 'Caveat_700Bold' : SANS[weight];
}
