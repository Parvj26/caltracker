import { typeScale, type TypeRole } from '@caltracker/design-tokens';
import type { TextStyle } from 'react-native';
import { fontFamilyFor } from './fonts';
import { palette, type Device } from './theme';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * React Native text style for a type role. Pure: same input, same output.
 * Weight is carried by the font family (one file per weight), so `fontWeight` is not set.
 */
export function textStyle(role: TypeRole, device: Device): TextStyle {
  const t = typeScale[role];
  const fontSize = t.size[device];
  const color = role === 'hand' ? palette.magentaDeep : t.muted ? palette.inkMuted : palette.ink;
  return {
    fontFamily: fontFamilyFor(t.family, t.weight),
    fontSize,
    ...(t.trackingEm !== undefined && { letterSpacing: round2(t.trackingEm * fontSize) }),
    color,
    ...(t.rotateDeg !== undefined && { transform: [{ rotate: `${t.rotateDeg}deg` }] }),
    ...(t.tabular && { fontVariant: ['tabular-nums'] }),
  };
}

/**
 * The workout logging pages read their text this much bigger than the rest of the app, so it is easy to read at
 * arm's length in the gym. App-wide sizes stay as they are.
 */
export const LOG_TEXT_SCALE = 1.1;

/** A type role on the logging pages: the app's size times LOG_TEXT_SCALE, rounded to whole points. */
export function logTextStyle(role: TypeRole, device: Device): TextStyle {
  const t = typeScale[role];
  const fontSize = Math.round(t.size[device] * LOG_TEXT_SCALE);
  const base = textStyle(role, device);
  return {
    ...base,
    fontSize,
    ...(t.trackingEm !== undefined && { letterSpacing: round2(t.trackingEm * fontSize) }),
  };
}

/**
 * The most a logging text may grow with the phone's text size (Dynamic Type), as a multiplier on its logging size.
 * `appCap` is the cap at the app's size; dividing by the logging scale keeps the largest size in points where it was,
 * so numbers that fit their box before still fit.
 */
export const logMaxFontScale = (appCap: number) => round2(appCap / LOG_TEXT_SCALE);
