import { describe, expect, it } from 'vitest';
import { encodeWithFallback, fitSquare, type ToBlob } from './image-resize';

describe('fitSquare', () => {
  it('crops the centre of a landscape photo to its short side and scales down to the max', () => {
    expect(fitSquare(4000, 3000, 1600)).toEqual({ sx: 500, sy: 0, side: 3000, size: 1600 });
  });
  it('crops a portrait photo from the middle', () => {
    expect(fitSquare(3000, 4000, 1600)).toEqual({ sx: 0, sy: 500, side: 3000, size: 1600 });
  });
  it('never scales a small picture up', () => {
    expect(fitSquare(800, 800, 1600)).toEqual({ sx: 0, sy: 0, side: 800, size: 800 });
    expect(fitSquare(900, 500, 1600).size).toBe(500);
  });
  it('gives the thumbnail size when asked', () => {
    expect(fitSquare(4000, 3000, 256).size).toBe(256);
  });
  it('still gives a square for an extreme panorama', () => {
    const c = fitSquare(20000, 100, 1600);
    expect(c).toEqual({ sx: 9950, sy: 0, side: 100, size: 100 });
    const tall = fitSquare(100, 20000, 1600);
    expect(tall).toEqual({ sx: 0, sy: 9950, side: 100, size: 100 });
  });
  it('stays inside the picture and never returns 0', () => {
    const c = fitSquare(1, 5000, 1600);
    expect(c.side).toBe(1);
    expect(c.size).toBe(1);
    expect(c.sy + c.side).toBeLessThanOrEqual(5000);
  });
});

describe('encodeWithFallback', () => {
  const fake =
    (answers: Record<string, string | null>): ToBlob =>
    (type) => {
      const answer = answers[type];
      return Promise.resolve(answer ? new Blob(['x'], { type: answer }) : null);
    };

  it('uses WebP when the browser can make it', async () => {
    const r = await encodeWithFallback(fake({ 'image/webp': 'image/webp', 'image/jpeg': 'image/jpeg' }), 0.85);
    expect(r.ext).toBe('webp');
    expect(r.blob.type).toBe('image/webp');
  });
  it('falls back to JPEG when the browser answers a WebP request with a PNG', async () => {
    const r = await encodeWithFallback(fake({ 'image/webp': 'image/png', 'image/jpeg': 'image/jpeg' }), 0.85);
    expect(r.ext).toBe('jpg');
    expect(r.blob.type).toBe('image/jpeg');
  });
  it('falls back to JPEG when WebP gives nothing at all', async () => {
    expect((await encodeWithFallback(fake({ 'image/webp': null, 'image/jpeg': 'image/jpeg' }), 0.85)).ext).toBe('jpg');
  });
  it('throws when neither format can be made', async () => {
    await expect(encodeWithFallback(fake({ 'image/webp': 'image/png', 'image/jpeg': 'image/png' }), 0.85)).rejects.toThrow();
  });
});
