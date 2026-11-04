import { breakpoints, colors, radius, space, type ColorToken } from '@caltracker/design-tokens';

export type Device = 'phone' | 'tablet';

/** Version 1 is light only (app.json pins userInterfaceStyle to light). */
export const palette: Record<ColorToken, string> = colors.light;

/** White, for labels on ink and magenta buttons. Kept here so screens never write a raw colour. */
export const white = palette.bg;

export function deviceFor(width: number): Device {
  return width >= breakpoints.tablet ? 'tablet' : 'phone';
}

export { radius, space };
