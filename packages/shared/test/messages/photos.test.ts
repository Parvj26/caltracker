import { describe, expect, it } from 'vitest';
import { fitWithin, isAlreadyUploaded, mergeById, photoPaths, thumbPathOf, MAX_PHOTOS } from '../../src/messages/photos';

describe('fitWithin', () => {
  it('shrinks the long edge to the limit and keeps the shape', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });
  it('never enlarges', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });
  it('keeps at least 1 px', () => {
    expect(fitWithin(10000, 2, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe('photo paths', () => {
  it('builds {workspace}/{conversation}/{id} and the -thumb twin', () => {
    expect(photoPaths('w', 'c', 'p')).toEqual({ full: 'w/c/p.webp', thumb: 'w/c/p-thumb.webp' });
    expect(photoPaths('w', 'c', 'p', 'jpg').thumb).toBe('w/c/p-thumb.jpg');
  });
  it('finds the thumbnail of a stored path', () => {
    expect(thumbPathOf('w/c/p.webp')).toBe('w/c/p-thumb.webp');
    expect(thumbPathOf('w/c/p.jpg')).toBe('w/c/p-thumb.jpg');
  });
  it('finds the thumbnail of a coach photo, keeping its extension', () => {
    expect(thumbPathOf('u1/avatar.webp')).toBe('u1/avatar-thumb.webp');
    expect(thumbPathOf('u1/avatar.jpg')).toBe('u1/avatar-thumb.jpg');
  });
  it('leaves a path that is not WebP or JPEG alone', () => {
    expect(thumbPathOf('u1/other.png')).toBe('u1/other.png');
  });
  it('allows up to 4 photos', () => {
    expect(MAX_PHOTOS).toBe(4);
  });
});

describe('isAlreadyUploaded', () => {
  it('treats a 409 or "already exists" as success', () => {
    expect(isAlreadyUploaded({ statusCode: '409' })).toBe(true);
    expect(isAlreadyUploaded({ status: 409 })).toBe(true);
    expect(isAlreadyUploaded({ message: 'The resource already exists' })).toBe(true);
  });
  it('does not for other errors', () => {
    expect(isAlreadyUploaded({ statusCode: '500' })).toBe(false);
    expect(isAlreadyUploaded({ statusCode: '413', message: 'Payload too large' })).toBe(false);
    expect(isAlreadyUploaded(new Error('The resource already exists'))).toBe(true);
    expect(isAlreadyUploaded(null)).toBe(false);
  });
});

describe('mergeById', () => {
  const m = (id: string, createdAt: string, body = id) => ({ id, createdAt, body });
  it('keeps equal times in id order', () => {
    const x = { id: 'x', createdAt: '2026-11-05T10:00:00Z' };
    const y = { id: 'y', createdAt: '2026-11-05T10:00:00Z' };
    expect(mergeById([y], [x]).map((m) => m.id)).toEqual(['x', 'y']);
  });
  it('replaces repeats, sorts oldest first, ties by id', () => {
    const out = mergeById([m('b', '2026-01-01T00:00:02Z'), m('a', '2026-01-01T00:00:01Z')], [m('b', '2026-01-01T00:00:02Z', 'new'), m('c', '2026-01-01T00:00:02Z')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(out[1]!.body).toBe('new');
  });
});
