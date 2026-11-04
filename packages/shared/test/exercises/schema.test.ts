import { describe, expect, it } from 'vitest';
import { CustomExerciseInput } from '../../src/exercises/schema';

const base = { name: 'Sled Push', trackingType: 'distance' as const };

describe('CustomExerciseInput', () => {
  it('accepts a minimal valid exercise and defaults optional fields', () => {
    const r = CustomExerciseInput.parse(base);
    expect(r.primaryMuscles).toEqual([]);
    expect(r.instructions).toEqual([]);
    expect(r.equipment).toBeNull();
    expect(r.youtubeUrl).toBeNull();
  });
  it('rejects an empty name', () => {
    expect(CustomExerciseInput.safeParse({ ...base, name: '   ' }).success).toBe(false);
  });
  it('rejects a name over 100 characters', () => {
    expect(CustomExerciseInput.safeParse({ ...base, name: 'x'.repeat(101) }).success).toBe(false);
  });
  it('rejects an unknown tracking type', () => {
    expect(CustomExerciseInput.safeParse({ ...base, trackingType: 'laps' }).success).toBe(false);
  });
  it('treats an empty youtube url as none', () => {
    expect(CustomExerciseInput.parse({ ...base, youtubeUrl: '' }).youtubeUrl).toBeNull();
  });
  it('stores youtube urls in canonical form', () => {
    expect(CustomExerciseInput.parse({ ...base, youtubeUrl: 'youtu.be/dQw4w9WgXcQ' }).youtubeUrl).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
  });
  it('rejects a vimeo url with the friendly copy', () => {
    const r = CustomExerciseInput.safeParse({ ...base, youtubeUrl: 'https://vimeo.com/12345' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Paste a YouTube link (youtube.com or youtu.be).');
  });
});
