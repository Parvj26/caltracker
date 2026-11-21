import { describe, expect, it } from 'vitest';
import { colors } from '../src/index';

describe('colour tokens (design spec section 2)', () => {
  it('matches every light value', () => {
    expect(colors.light).toEqual({
      bg: '#FFFFFF',
      surface: '#F4F4F4',
      surfaceSidebar: '#F6F6F4',
      border: '#EDEDED',
      borderStrong: '#8A8A8A',
      ink: '#121212',
      inkMuted: 'rgba(18, 18, 18, 0.6)',
      lime: '#C8F169',
      pink: '#B9E3FF',
      blue: '#B9E3FF',
      drop: '#E3F3FF',
      magenta: '#2F6FE0',
      magentaDeep: '#1F4FB0',
      amber: '#FFB020',
      celebrateBg: '#FFF8D9',
      tape: '#FFE48A',
      danger: '#B3261E',
      dangerDeep: '#8C1D18',
      dangerBg: '#FBE9E7',
      amberDeep: '#C77E00',
      mapSkin: '#EFEFEC',
      mapOutline: '#C9C9C4',
      mapRegion: '#D3D3D3',
      mapOver: '#E5484D',
      mapUnderBg: '#D5E3FB',
      mapNormal: '#BFE6CB',
      mapNormalLine: '#1E6E38',
    });
  });
});

describe('web breakpoints (UI rules §1)', () => {
  it('has phone < 600, tablet 600–1199 and desktop ≥ 1200', async () => {
    const { breakpoints } = await import('../src/index');
    expect(breakpoints.tablet).toBe(600);
    expect(breakpoints.desktop).toBe(1200);
  });
});
