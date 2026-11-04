import { colors, type ThemeName } from './colors';
import { borderWidth, buttonBase, buttonMinHeight, pressDepth, radius, shadow, space, tapTarget } from './scale';
import { typeScale } from './typography';

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** One `:root{...}` rule exposing the tokens as `--ct-*` custom properties. */
export function toCssVariables(theme: ThemeName = 'light'): string {
  const vars: string[] = [];
  for (const [k, v] of Object.entries(colors[theme])) vars.push(`--ct-${kebab(k)}:${v};`);
  for (const [k, v] of Object.entries(radius)) vars.push(`--ct-radius-${k}:${v}px;`);
  for (const [k, v] of Object.entries(space)) vars.push(`--ct-space-${k.replace('.', '-')}:${v}px;`);
  for (const [k, v] of Object.entries(borderWidth)) vars.push(`--ct-border-width-${kebab(k)}:${v}px;`);
  vars.push(`--ct-base:${buttonBase}px;`);
  vars.push(`--ct-press:${pressDepth}px;`);
  vars.push(`--ct-button-min-height:${buttonMinHeight.web}px;`);
  for (const [k, v] of Object.entries(tapTarget)) vars.push(`--ct-tap-${k}:${v}px;`);
  vars.push(`--ct-shadow-sticker:${shadow.sticker};`);
  for (const [k, v] of Object.entries(typeScale)) {
    const role = kebab(k);
    vars.push(`--ct-size-${role}:${v.size.web}px;`);
    vars.push(`--ct-weight-${role}:${v.weight};`);
    if (v.trackingEm !== undefined) vars.push(`--ct-tracking-${role}:${v.trackingEm}em;`);
    if (v.rotateDeg !== undefined) vars.push(`--ct-rotate-${role}:${v.rotateDeg}deg;`);
  }
  return `:root{${vars.join('')}}`;
}
