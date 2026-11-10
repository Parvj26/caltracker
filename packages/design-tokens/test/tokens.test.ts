import { describe, expect, it } from 'vitest';
import { colors } from '../src/index';

describe('colour tokens (design spec section 2)', () => {
  it('matches every light value', () => {
    expect(colors.light).toEqual({
      bg: '#FFFFFF',
      surface: '#F4F4F4',
      surfaceSidebar: '#F6F6F4',
      border: '#EDEDED',
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
    });
  });
});
