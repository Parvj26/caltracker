import { describe, expect, it } from 'vitest';
import { photoDisplaySize, photoSourceFor } from '../../src/media/display';

describe('photoDisplaySize', () => {
  it('fills the width and keeps the shape of a wide photo', () => {
    expect(photoDisplaySize({ width: 1600, height: 900 }, { maxWidth: 400, maxHeight: 600 })).toEqual({ width: 400, height: 225 });
  });
  it('enlarges a small photo to the full width (the box, not the file, sets the size)', () => {
    expect(photoDisplaySize({ width: 200, height: 100 }, { maxWidth: 400, maxHeight: 600 })).toEqual({ width: 400, height: 200 });
  });
  it('caps a tall photo at the max height and narrows it, so nothing is cropped', () => {
    expect(photoDisplaySize({ width: 900, height: 1600 }, { maxWidth: 400, maxHeight: 400 })).toEqual({ width: 225, height: 400 });
  });
  it('a square photo in a short box is limited by the height', () => {
    expect(photoDisplaySize({ width: 1000, height: 1000 }, { maxWidth: 400, maxHeight: 300 })).toEqual({ width: 300, height: 300 });
  });
  it('falls back to a square when the size is unknown or broken', () => {
    expect(photoDisplaySize({ width: 0, height: 0 }, { maxWidth: 400, maxHeight: 300 })).toEqual({ width: 300, height: 300 });
    expect(photoDisplaySize(null, { maxWidth: 240, maxHeight: 320 })).toEqual({ width: 240, height: 240 });
    expect(photoDisplaySize({ width: Number.NaN, height: 10 }, { maxWidth: 240, maxHeight: 320 })).toEqual({ width: 240, height: 240 });
  });
  it('never returns less than 1 px', () => {
    expect(photoDisplaySize({ width: 10000, height: 1 }, { maxWidth: 300, maxHeight: 300 })).toEqual({ width: 300, height: 1 });
  });
});

describe('photoSourceFor', () => {
  it('uses the thumbnail for small previews that it covers sharply', () => {
    expect(photoSourceFor({ width: 88, height: 88 }, 3)).toBe('thumb');
    expect(photoSourceFor({ width: 160, height: 120 }, 2)).toBe('thumb');
  });
  it('uses the full photo once the screen needs more pixels than the 320 px thumbnail has', () => {
    expect(photoSourceFor({ width: 224, height: 224 }, 3)).toBe('full');
    expect(photoSourceFor({ width: 161, height: 100 }, 2)).toBe('full');
    expect(photoSourceFor({ width: 360, height: 200 }, 1)).toBe('full');
  });
  it('looks at the long edge', () => {
    expect(photoSourceFor({ width: 50, height: 200 }, 2)).toBe('full');
  });
  it('honours a different thumbnail size', () => {
    expect(photoSourceFor({ width: 200, height: 200 }, 2, 512)).toBe('thumb');
  });
  it('treats a missing or broken pixel ratio as 1', () => {
    expect(photoSourceFor({ width: 300, height: 300 }, 0)).toBe('thumb');
    expect(photoSourceFor({ width: 300, height: 300 }, Number.NaN)).toBe('thumb');
  });
});
