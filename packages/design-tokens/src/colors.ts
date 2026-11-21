export type ColorToken =
  | 'bg'
  | 'surface'
  | 'surfaceSidebar'
  | 'border'
  | 'borderStrong'
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
  | 'tape'
  | 'danger'
  | 'dangerDeep'
  | 'dangerBg'
  | 'amberDeep'
  | 'mapSkin'
  | 'mapOutline'
  | 'mapRegion'
  | 'mapOver'
  | 'mapUnderBg'
  | 'mapNormal'
  | 'mapNormalLine';

// Values copied verbatim from docs/superpowers/specs/2026-11-03-design-system-design.md section 2.
export const colors: { light: Record<ColorToken, string> } = {
  light: {
    bg: '#FFFFFF',
    surface: '#F4F4F4',
    surfaceSidebar: '#F6F6F4',
    border: '#EDEDED',
    // 2026-11-17 (UI rules §2.8): input borders, chip outlines and other non-text edges that must reach 3:1.
    borderStrong: '#8A8A8A',
    ink: '#121212',
    inkMuted: 'rgba(18, 18, 18, 0.6)',
    lime: '#C8F169',
    // 2026-11-09: the PO swapped pink for blue. Token names kept so nothing else changes:
    // pink = light blue, drop = very light blue, magenta = strong blue, magentaDeep = deep blue.
    pink: '#B9E3FF',
    blue: '#B9E3FF',
    drop: '#E3F3FF',
    magenta: '#2F6FE0',
    magentaDeep: '#1F4FB0',
    amber: '#FFB020',
    celebrateBg: '#FFF8D9',
    tape: '#FFE48A',
    // 2026-11-10: destructive actions only (Delete account), from the approved Delete account board.
    danger: '#B3261E',
    dangerDeep: '#8C1D18',
    dangerBg: '#FBE9E7',
    // 2026-11-20: the body map (movement assessments, flags), from the approved AS4 / AS9 boards. amberDeep outlines a
    // flag's dashed ring. The map's cues besides colour: over = solid mapOver, under = magenta hatching on mapUnderBg,
    // normal = mapNormal with a mapNormalLine outline and tick, unmarked = mapRegion.
    amberDeep: '#C77E00',
    mapSkin: '#EFEFEC',
    mapOutline: '#C9C9C4',
    mapRegion: '#D3D3D3',
    mapOver: '#E5484D',
    mapUnderBg: '#D5E3FB',
    mapNormal: '#BFE6CB',
    mapNormalLine: '#1E6E38',
  },
};

export type ThemeName = keyof typeof colors;
