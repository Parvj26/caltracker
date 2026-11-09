import { describe, expect, it } from 'vitest';
import { fontFamilyFor } from './fonts';
import { LOG_TEXT_SCALE, logMaxFontScale, logTextStyle, textStyle } from './typography';

describe('textStyle', () => {
  it('builds the phone screen title from the tokens', () => {
    expect(textStyle('screenTitle', 'phone')).toEqual({
      fontFamily: 'BricolageGrotesque_800ExtraBold',
      fontSize: 22,
      letterSpacing: -0.44,
      color: '#121212',
    });
  });

  it('uses the tablet size on tablets', () => {
    expect(textStyle('screenTitle', 'tablet').fontSize).toBe(24);
  });

  it('makes the note easy to read: the app font, bold, deep magenta, not tilted', () => {
    const hand = textStyle('hand', 'phone');
    expect(hand.fontFamily).toBe('BricolageGrotesque_700Bold');
    expect(hand.fontSize).toBe(17);
    expect(hand.color).toBe('#B32C6C');
    expect(hand.transform).toBeUndefined();
  });

  it('mutes captions', () => {
    expect(textStyle('caption', 'phone').color).toBe('rgba(18, 18, 18, 0.6)');
  });

  it('uses tabular figures for big numbers', () => {
    expect(textStyle('bigNumber', 'phone').fontVariant).toEqual(['tabular-nums']);
  });

  it('rounds tracking to avoid float noise', () => {
    expect(textStyle('button', 'phone').letterSpacing).toBe(0.45);
  });
});

describe('logTextStyle', () => {
  it('makes the logging pages 10% bigger, in whole points', () => {
    expect(LOG_TEXT_SCALE).toBe(1.1);
    const sizes = (['screenTitle', 'sectionHeading', 'body', 'caption', 'button'] as const).map((r) => logTextStyle(r, 'phone').fontSize);
    expect(sizes).toEqual([24, 18, 17, 13, 17]);
    expect(logTextStyle('screenTitle', 'tablet').fontSize).toBe(26);
    expect(logTextStyle('button', 'tablet').fontSize).toBe(18);
  });

  it('keeps everything else of the role', () => {
    const app = textStyle('caption', 'phone');
    expect(logTextStyle('caption', 'phone')).toEqual({ ...app, fontSize: 13 });
    expect(logTextStyle('bigNumber', 'phone').fontVariant).toEqual(['tabular-nums']);
  });

  it('scales tracking with the bigger size', () => {
    expect(logTextStyle('button', 'phone').letterSpacing).toBe(0.51);
  });

  it('leaves the app-wide sizes alone', () => {
    expect(textStyle('sectionHeading', 'phone').fontSize).toBe(16);
    expect(textStyle('button', 'phone').fontSize).toBe(15);
  });

  it('keeps the largest Dynamic Type size where the app cap had it', () => {
    expect(logMaxFontScale(1.4)).toBe(1.27);
    // Box numbers: 16 × 1.4 = 22.4 pt before; 18 × 1.27 = 22.86 pt now (within half a point).
    expect(Math.abs(18 * logMaxFontScale(1.4) - 16 * 1.4)).toBeLessThan(0.5);
  });
});

describe('fontFamilyFor', () => {
  it('maps family and weight to the loaded font names', () => {
    expect(fontFamilyFor('sans', 500)).toBe('BricolageGrotesque_500Medium');
    expect(fontFamilyFor('sans', 700)).toBe('BricolageGrotesque_700Bold');
    expect(fontFamilyFor('sans', 800)).toBe('BricolageGrotesque_800ExtraBold');
    expect(fontFamilyFor('hand', 700)).toBe('Caveat_700Bold');
  });
});
