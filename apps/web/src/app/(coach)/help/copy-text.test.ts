import { describe, expect, it, vi } from 'vitest';
import { copyText } from './copy-text';

function fakeDocument(execResult: boolean) {
  const area = { value: '', style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn() };
  const doc = {
    createElement: vi.fn(() => area),
    body: { appendChild: vi.fn() },
    execCommand: vi.fn(() => execResult),
  };
  // A stand-in for the few parts of the DOM copyText touches.
  return { doc: doc as typeof doc & Parameters<typeof copyText>[1]['document'], area };
}

describe('copyText', () => {
  it('uses the clipboard API when it works', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const { doc } = fakeDocument(true);
    expect(await copyText('hi@x.app', { clipboard: { writeText }, document: doc })).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hi@x.app');
    expect(doc.execCommand).not.toHaveBeenCalled();
  });

  it('falls back to a hidden text box when the clipboard API is missing', async () => {
    const { doc, area } = fakeDocument(true);
    expect(await copyText('hi@x.app', { clipboard: undefined, document: doc })).toBe(true);
    expect(area.value).toBe('hi@x.app');
    expect(area.select).toHaveBeenCalled();
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
    expect(area.remove).toHaveBeenCalled();
  });

  it('falls back when the clipboard API refuses (no permission, not a secure page)', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    const { doc } = fakeDocument(true);
    expect(await copyText('hi@x.app', { clipboard: { writeText }, document: doc })).toBe(true);
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
  });

  it('says so when neither way works', async () => {
    const { doc, area } = fakeDocument(false);
    expect(await copyText('hi@x.app', { clipboard: undefined, document: doc })).toBe(false);
    expect(area.remove).toHaveBeenCalled();
  });

  it('says so when the fallback throws', async () => {
    const { doc } = fakeDocument(true);
    doc.execCommand.mockImplementation(() => {
      throw new Error('nope');
    });
    expect(await copyText('hi@x.app', { clipboard: undefined, document: doc })).toBe(false);
  });
});
