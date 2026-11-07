import { breakpoints, colors, radius, space, tapTarget, type ColorToken } from '@caltracker/design-tokens';

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

/** How far a custom pressable fades while pressed (the UI kit's buttons use the same). */
export const pressedOpacity = 0.75;

export { radius, space };

/** Sticker sizes and fades (reveal, sheet, zoo book). */
export const stickerTheme = {
  revealSize: { phone: 220, tablet: 280 },
  sheetSize: 200,
  landmarkSize: 64,
  summarySize: 72,
  burstScale: 1.35,
  burstOpacity: 0.9,
  scrimOpacity: 0.4,
  dimOpacity: 0.7,
  factOpacity: 0.85,
  pathDot: 12,
} as const;

/** The square exercise photo beside an exercise name. */
export const exerciseThumbSize = 40;

/** Height of each photo in the exercise info sheet (full width, cropped to fill). */
export const exercisePhotoHeight = tapTarget.logging * 4;

/** Width of the Delete button a swiped set row reveals. */
export const swipeDeleteWidth = tapTarget.logging + space[6] + space[2];

