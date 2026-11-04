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
  const color = t.family === 'hand' ? palette.magenta : t.muted ? palette.inkMuted : palette.ink;
  return {
    fontFamily: fontFamilyFor(t.family, t.weight),
    fontSize,
    ...(t.trackingEm !== undefined && { letterSpacing: round2(t.trackingEm * fontSize) }),
    color,
    ...(t.rotateDeg !== undefined && { transform: [{ rotate: `${t.rotateDeg}deg` }] }),
    ...(t.tabular && { fontVariant: ['tabular-nums'] }),
  };
}
