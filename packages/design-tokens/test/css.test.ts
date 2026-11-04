import { describe, expect, it } from 'vitest';
import { toCssVariables } from '../src/index';

describe('toCssVariables', () => {
  const css = toCssVariables();
  it('is a single :root rule', () => {
    expect(css.startsWith(':root{')).toBe(true);
    expect(css.endsWith('}')).toBe(true);
  });
  it('emits colour, radius, size and shadow variables', () => {
    expect(css).toContain('--ct-lime:#C8F169;');
    expect(css).toContain('--ct-surface-sidebar:#F6F6F4;');
    expect(css).toContain('--ct-ink-muted:rgba(18, 18, 18, 0.6);');
    expect(css).toContain('--ct-radius-card:20px;');
    expect(css).toContain('--ct-space-2-5:10px;');
    expect(css).toContain('--ct-size-screen-title:24px;');
    expect(css).toContain('--ct-shadow-sticker:0 2px 6px rgba(0,0,0,.2);');
  });
  it('contains no undefined', () => {
    expect(css).not.toContain('undefined');
  });
});
