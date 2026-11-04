import { describe, expect, it } from 'vitest';
import { colors, CONTRAST_PAIRS, contrastRatio, type ColorToken } from '../src/index';

const c = colors.light;
const resolve = (t: ColorToken | 'white') => (t === 'white' ? '#FFFFFF' : c[t]);

describe('contrastRatio', () => {
  it('computes black-ish on white', () => {
    expect(contrastRatio('#121212', '#FFFFFF')).toBeCloseTo(18.73, 1);
  });
  it('accepts short hex', () => {
    expect(contrastRatio('#000', '#FFF')).toBeCloseTo(21, 5);
  });
  it('blends an alpha foreground onto the background', () => {
    expect(contrastRatio('rgba(0, 0, 0, 1)', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('rgba(0, 0, 0, 0)', '#FFFFFF')).toBeCloseTo(1, 5);
  });
});

describe('CONTRAST_PAIRS', () => {
  it.each(CONTRAST_PAIRS.map((p) => [`${p.fg} on ${p.bg}`, p] as const))('%s passes', (_n, p) => {
    expect(contrastRatio(resolve(p.fg), resolve(p.bg))).toBeGreaterThanOrEqual(p.min);
  });

  const has = (fg: ColorToken | 'white', bg: ColorToken, min: number) =>
    CONTRAST_PAIRS.some((p) => p.fg === fg && p.bg === bg && p.min >= min);

  it('covers the required pairs', () => {
    for (const bg of ['bg', 'surface', 'surfaceSidebar'] as const) {
      expect(has('ink', bg, 15)).toBe(true);
      expect(has('inkMuted', bg, 4.5)).toBe(true);
    }
    for (const bg of ['lime', 'pink', 'blue', 'drop', 'celebrateBg', 'tape'] as const) {
      expect(has('ink', bg, 12)).toBe(true);
    }
    expect(has('white', 'ink', 15)).toBe(true);
    expect(has('magenta', 'bg', 3)).toBe(true);
    expect(has('white', 'magenta', 3)).toBe(true);
  });

  it('documents why captions on pastel tiles use ink, not inkMuted', () => {
    expect(contrastRatio(c.inkMuted, c.pink)).toBeLessThan(4.5);
  });
});
