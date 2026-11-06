import { describe, expect, it } from 'vitest';
import { PhotoError, encodeWithFallback } from './compress-image';

describe('encodeWithFallback', () => {
  const blob = (type: string) => new Blob(['x'], { type });
  it('keeps WebP when the browser can write it', async () => {
    const asked: string[] = [];
    const out = await encodeWithFallback((type) => (asked.push(type), Promise.resolve(blob(type))));
    expect(out.ext).toBe('webp');
    expect(asked).toEqual(['image/webp']);
  });
  it('falls back to JPEG when the browser answers a WebP request with a PNG (Safari)', async () => {
    const asked: Array<[string, number]> = [];
    const out = await encodeWithFallback((type, q) => (asked.push([type, q]), Promise.resolve(blob(type === 'image/webp' ? 'image/png' : type))));
    expect(out.ext).toBe('jpg');
    expect(out.blob.type).toBe('image/jpeg');
    expect(asked[1]).toEqual(['image/jpeg', 0.85]);
  });
  it('falls back when the encoder returns nothing for WebP', async () => {
    const out = await encodeWithFallback((type) => Promise.resolve(type === 'image/webp' ? null : blob(type)));
    expect(out.ext).toBe('jpg');
  });
  it('gives up when neither format can be written', async () => {
    await expect(encodeWithFallback(() => Promise.resolve(blob('image/png')))).rejects.toBeInstanceOf(PhotoError);
  });
});
