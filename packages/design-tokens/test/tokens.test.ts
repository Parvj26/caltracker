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
      pink: '#FFC9E3',
      blue: '#B9E3FF',
      drop: '#FFE3F0',
      magenta: '#E0408A',
      magentaDeep: '#B32C6C',
      amber: '#FFB020',
      celebrateBg: '#FFF8D9',
      tape: '#FFE48A',
    });
  });
});
