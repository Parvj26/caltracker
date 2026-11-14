import { describe, expect, it } from 'vitest';
import { shortcutHint } from './shortcut-hint';

const desk = { finePointer: true, maxTouchPoints: 0 };

describe('shortcutHint', () => {
  it('shows ⌘K on a Mac and Ctrl K on Windows/Linux with a mouse or trackpad', () => {
    expect(shortcutHint({ ...desk, platform: 'MacIntel' })).toBe('⌘K');
    expect(shortcutHint({ ...desk, platform: 'macOS' })).toBe('⌘K');
    expect(shortcutHint({ ...desk, platform: 'Win32' })).toBe('Ctrl K');
    expect(shortcutHint({ ...desk, platform: 'Linux x86_64' })).toBe('Ctrl K');
  });

  it('shows nothing on an iPhone or iPad, even one with a keyboard attached', () => {
    expect(shortcutHint({ ...desk, platform: 'iPhone' })).toBe('');
    expect(shortcutHint({ ...desk, platform: 'iPad' })).toBe('');
    // iPadOS Safari reports itself as a Mac; only the touch points give it away.
    expect(shortcutHint({ platform: 'MacIntel', finePointer: true, maxTouchPoints: 5 })).toBe('');
  });

  it('shows nothing on a touch-first device (coarse pointer), such as an Android phone', () => {
    expect(shortcutHint({ platform: 'Linux armv8l', finePointer: false, maxTouchPoints: 5 })).toBe('');
  });
});
