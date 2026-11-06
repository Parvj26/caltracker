import { describe, expect, it } from 'vitest';
import { AVATAR_MAX_BYTES, THUMB_MAX_BYTES, acceptableAvatarFiles, looksLike } from './avatar-files';

const bytes = (...b: number[]) => new Blob([new Uint8Array(b)]);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const webp = () => bytes(...ascii('RIFF'), 1, 0, 0, 0, ...ascii('WEBP'), 0, 0);
const jpeg = () => bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const png = () => bytes(0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);

describe('looksLike', () => {
  it('accepts real WebP and JPEG headers', async () => {
    expect(await looksLike(webp(), 'webp')).toBe(true);
    expect(await looksLike(jpeg(), 'jpg')).toBe(true);
  });
  it('rejects a PNG for either format', async () => {
    expect(await looksLike(png(), 'webp')).toBe(false);
    expect(await looksLike(png(), 'jpg')).toBe(false);
  });
  it('rejects a truncated RIFF header', async () => {
    expect(await looksLike(bytes(...ascii('RIFF'), 1, 0), 'webp')).toBe(false);
    expect(await looksLike(bytes(...ascii('RIFF'), 1, 0, 0, 0, ...ascii('WAVE')), 'webp')).toBe(false);
  });
  it('rejects JPEG bytes sent as webp, and WebP bytes sent as jpg', async () => {
    expect(await looksLike(jpeg(), 'webp')).toBe(false);
    expect(await looksLike(webp(), 'jpg')).toBe(false);
  });
});

describe('acceptableAvatarFiles', () => {
  it('accepts a matching pair', async () => {
    expect(await acceptableAvatarFiles(webp(), webp(), 'webp')).toBe(true);
    expect(await acceptableAvatarFiles(jpeg(), jpeg(), 'jpg')).toBe(true);
  });
  it('rejects an empty file', async () => {
    expect(await acceptableAvatarFiles(new Blob([]), webp(), 'webp')).toBe(false);
    expect(await acceptableAvatarFiles(webp(), new Blob([]), 'webp')).toBe(false);
  });
  it('rejects an oversize photo or thumbnail', async () => {
    const big = (n: number) => new Blob([webp(), new Uint8Array(n)]);
    expect(await acceptableAvatarFiles(big(AVATAR_MAX_BYTES), webp(), 'webp')).toBe(false);
    expect(await acceptableAvatarFiles(webp(), big(THUMB_MAX_BYTES), 'webp')).toBe(false);
  });
  it('rejects a pair that does not match the claimed format', async () => {
    expect(await acceptableAvatarFiles(jpeg(), jpeg(), 'webp')).toBe(false);
    expect(await acceptableAvatarFiles(webp(), jpeg(), 'webp')).toBe(false);
    expect(await acceptableAvatarFiles(png(), png(), 'jpg')).toBe(false);
  });
});
