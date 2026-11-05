import { describe, expect, it } from 'vitest';
import { fontFamilyFor } from './fonts';
import { textStyle } from './typography';

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

  it('makes the hand note Caveat, magenta and tilted', () => {
    const hand = textStyle('hand', 'phone');
    expect(hand.fontFamily).toBe('Caveat_700Bold');
    expect(hand.color).toBe('#E0408A');
    expect(hand.transform).toEqual([{ rotate: '-3deg' }]);
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

describe('fontFamilyFor', () => {
  it('maps family and weight to the loaded font names', () => {
    expect(fontFamilyFor('sans', 500)).toBe('BricolageGrotesque_500Medium');
    expect(fontFamilyFor('sans', 700)).toBe('BricolageGrotesque_700Bold');
    expect(fontFamilyFor('sans', 800)).toBe('BricolageGrotesque_800ExtraBold');
    expect(fontFamilyFor('hand', 700)).toBe('Caveat_700Bold');
  });
});
