export type ColorToken =
  | 'bg'
  | 'surface'
  | 'surfaceSidebar'
  | 'border'
  | 'ink'
  | 'inkMuted'
  | 'lime'
  | 'pink'
  | 'blue'
  | 'drop'
  | 'magenta'
  | 'magentaDeep'
  | 'amber'
  | 'celebrateBg'
  | 'tape';

// Values copied verbatim from docs/superpowers/specs/2026-11-03-design-system-design.md section 2.
export const colors: { light: Record<ColorToken, string> } = {
  light: {
    bg: '#FFFFFF',
    surface: '#F4F4F4',
    surfaceSidebar: '#F6F6F4',
    border: '#EDEDED',
    ink: '#121212',
    inkMuted: 'rgba(18, 18, 18, 0.6)',
    lime: '#C8F169',
    pink: '#FFC9E3',
    blue: '#B9E3FF',
    drop: '#FFE3F0',
    magenta: '#E0408A',
    magentaDeep: '#B32C6C',
    amber: '#FFB020',
    celebrateBg: '#FFF8D9',
    tape: '#FFE48A',
  },
};

export type ThemeName = keyof typeof colors;
