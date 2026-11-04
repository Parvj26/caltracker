import { colors, type ThemeName } from './colors';
import { radius, shadow, space } from './scale';
import { typeScale } from './typography';

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** One `:root{...}` rule exposing the tokens as `--ct-*` custom properties. */
export function toCssVariables(theme: ThemeName = 'light'): string {
  const vars: string[] = [];
  for (const [k, v] of Object.entries(colors[theme])) vars.push(`--ct-${kebab(k)}:${v};`);
  for (const [k, v] of Object.entries(radius)) vars.push(`--ct-radius-${k}:${v}px;`);
  for (const [k, v] of Object.entries(space)) vars.push(`--ct-space-${k.replace('.', '-')}:${v}px;`);
  vars.push(`--ct-shadow-sticker:${shadow.sticker};`);
  for (const [k, v] of Object.entries(typeScale)) vars.push(`--ct-size-${kebab(k)}:${v.size.web}px;`);
  return `:root{${vars.join('')}}`;
}
