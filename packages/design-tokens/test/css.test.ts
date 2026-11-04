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

describe('toCssVariables shape tokens', () => {
  const css = toCssVariables();
  it('emits button base, press depth, border widths and sizing', () => {
    expect(css).toContain('--ct-base:4px;');
    expect(css).toContain('--ct-press:2px;');
    expect(css).toContain('--ct-border-width-card:2px;');
    expect(css).toContain('--ct-border-width-secondary-button:1.5px;');
    expect(css).toContain('--ct-button-min-height:48px;');
    expect(css).toContain('--ct-tap-min:44px;');
  });
  it('emits type weights, tracking and the hand rotation', () => {
    expect(css).toContain('--ct-weight-body:500;');
    expect(css).toContain('--ct-weight-button:800;');
    expect(css).toContain('--ct-tracking-screen-title:-0.02em;');
    expect(css).toContain('--ct-tracking-button:0.03em;');
    expect(css).toContain('--ct-rotate-hand:-3deg;');
  });
});
