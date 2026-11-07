import { describe, expect, it, vi } from 'vitest';
import { SAVE_MESSAGES, saveCard, type SaveImageDeps } from './save-image-logic';

function deps(over: Partial<SaveImageDeps> = {}): SaveImageDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    requestAddPermission: vi.fn(() => {
      calls.push('permission');
      return Promise.resolve(true);
    }),
    capture: vi.fn((fallback: boolean) => {
      calls.push(fallback ? 'capture-fallback' : 'capture');
      return Promise.resolve('file:///tmp/card.png');
    }),
    addToLibrary: vi.fn((uri: string) => {
      calls.push(`save ${uri}`);
      return Promise.resolve();
    }),
    report: vi.fn(),
    ...over,
  };
}

describe('saveCard', () => {
  it('asks for permission, draws the card and adds that file to Photos', async () => {
    const d = deps();
    expect(await saveCard(d)).toBe('saved');
    expect(d.calls).toEqual(['permission', 'capture', 'save file:///tmp/card.png']);
    expect(d.report).not.toHaveBeenCalled();
  });

  it('stops at a refused permission without drawing or saving', async () => {
    const d = deps({ requestAddPermission: () => Promise.resolve(false) });
    expect(await saveCard(d)).toBe('denied');
    expect(d.capture).not.toHaveBeenCalled();
    expect(d.addToLibrary).not.toHaveBeenCalled();
  });

  it('retries a failed capture once with the fallback renderer', async () => {
    const capture = vi.fn((fallback: boolean) =>
      fallback ? Promise.resolve('file:///tmp/fallback.png') : Promise.reject(new Error('drawViewHierarchyInRect was not successful')),
    );
    const d = deps({ capture });
    expect(await saveCard(d)).toBe('saved');
    expect(capture.mock.calls).toEqual([[false], [true]]);
    expect(d.addToLibrary).toHaveBeenCalledWith('file:///tmp/fallback.png');
    expect(d.report).toHaveBeenCalledWith('capture', expect.any(Error));
  });

  it('fails, and reports both errors, when both renderers fail', async () => {
    const d = deps({ capture: () => Promise.reject(new Error('no view')) });
    expect(await saveCard(d)).toBe('failed');
    expect(d.addToLibrary).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledTimes(2);
  });

  it('reports a library error instead of swallowing it', async () => {
    const err = new Error('Method saveToLibraryAsync imported from "expo-media-library" is deprecated.');
    const d = deps({ addToLibrary: () => Promise.reject(err) });
    expect(await saveCard(d)).toBe('failed');
    expect(d.report).toHaveBeenCalledWith('save', err);
  });

  it('treats a crash while asking for permission as a failure, not a refusal', async () => {
    const d = deps({ requestAddPermission: () => Promise.reject(new Error('missing plist key')) });
    expect(await saveCard(d)).toBe('failed');
    expect(d.report).toHaveBeenCalledWith('permission', expect.any(Error));
  });

  it('confirms with the toast text the product owner asked for', () => {
    expect(SAVE_MESSAGES.saved).toBe('Saved to Photos');
    expect(SAVE_MESSAGES.denied).toMatch(/Settings/);
  });
});

describe('save-image wiring', () => {
  it('never uses the media-library functions that throw at runtime in version 58', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./save-image.ts', import.meta.url), 'utf8');
    const code = src.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/saveToLibraryAsync|createAssetAsync|import \* as MediaLibrary/);
    expect(code).toMatch(/Asset\.create\(/);
  });
});
