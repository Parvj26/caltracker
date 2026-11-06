import { breakpoints, colors, radius, space, tapTarget, typeScale, type ColorToken } from '@caltracker/design-tokens';

export type Device = 'phone' | 'tablet';

/** Version 1 is light only (app.json pins userInterfaceStyle to light). */
export const palette: Record<ColorToken, string> = colors.light;

/** White, for labels on ink and magenta buttons. Kept here so screens never write a raw colour. */
export const white = palette.bg;

export function deviceFor(width: number): Device {
  return width >= breakpoints.tablet ? 'tablet' : 'phone';
}

/** Widest a screen's column gets (phones use the full width; iPad keeps a readable column). */
export const contentMaxWidth = 480;

/** The rest countdown: the big-number style grown so it reads at arm's length from a bench. */
export const restClock = {
  fontSize: Math.round(typeScale.bigNumber.size.phone * 1.7),
  lineHeight: Math.round(typeScale.bigNumber.size.phone * 2),
};

/** An actual-value box on a set row: wide enough for 5 characters ("135.5", "1000") after padding and border. */
export const actualInputWidth = tapTarget.logging + space[6];

/** How far a too-long value may shrink in its box before it is cut off. */
export const actualInputMinFontScale = 0.6;

/** How far a custom pressable fades while pressed (the UI kit's buttons use the same). */
export const pressedOpacity = 0.75;

export { radius, space };
