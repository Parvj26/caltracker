import { describe, expect, it } from 'vitest';
import { PhotoError, encodeWithFallback, fitWithin, photoPaths, thumbPathOf } from './compress-image';

describe('fitWithin', () => {
  it('shrinks a landscape photo to the long edge', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });
  it('shrinks a portrait photo to the long edge', () => {
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });
  it('never enlarges a small photo', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });
  it('keeps a very thin photo at least 1 px', () => {
    expect(fitWithin(10000, 2, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe('photoPaths', () => {
  it('lays the photo out under its workspace and conversation', () => {
    expect(photoPaths('w', 'c', 'p')).toEqual({ full: 'w/c/p.webp', thumb: 'w/c/p-thumb.webp' });
  });
  it('finds the thumbnail of a stored path', () => {
    expect(thumbPathOf('w/c/p.webp')).toBe('w/c/p-thumb.webp');
  });
});

describe('photo paths for JPEG', () => {
  it('uses the jpg extension for the photo and its thumbnail', () => {
    expect(photoPaths('w', 'c', 'p', 'jpg')).toEqual({ full: 'w/c/p.jpg', thumb: 'w/c/p-thumb.jpg' });
    expect(thumbPathOf('w/c/p.jpg')).toBe('w/c/p-thumb.jpg');
  });
});

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
