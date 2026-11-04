import type { ColorToken, TypeRole } from '@caltracker/design-tokens';
import { useMemo } from 'react';
import { useWindowDimensions, type TextStyle } from 'react-native';
import { deviceFor, palette, radius, space, type Device } from './theme';
import { textStyle } from './typography';

export type Theme = {
  colors: Record<ColorToken, string>;
  text: (role: TypeRole) => TextStyle;
  space: typeof space;
  radius: typeof radius;
  device: Device;
};

/** Always the light theme in Version 1. `device` is 'tablet' at 600 pt wide and up. */
export function useTheme(): Theme {
  const { width } = useWindowDimensions();
  const device = deviceFor(width);
  return useMemo(
    () => ({ colors: palette, text: (role: TypeRole) => textStyle(role, device), space, radius, device }),
    [device],
  );
}
