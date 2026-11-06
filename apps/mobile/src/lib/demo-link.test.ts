import { describe, expect, it } from 'vitest';
import { demoUrl, exerciseDemoUrl, openableDemoUrl } from './demo-link';

describe('demoUrl', () => {
  it('turns any YouTube video link into the canonical watch link', () => {
    const want = demoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(want).toMatch(/dQw4w9WgXcQ/);
    expect(demoUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(want);
  });

  it('refuses anything that is not a YouTube video', () => {
    for (const bad of ['javascript:alert(1)', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'tel:123', 'https://youtu.be/short', '', null, undefined]) {
      expect(demoUrl(bad)).toBeNull();
    }
  });
});

describe('openableDemoUrl', () => {
  it('also allows the app’s own YouTube search, but no other search or site', () => {
    const search = 'https://www.youtube.com/results?search_query=Squat%20form';
    expect(openableDemoUrl(search)).toBe(search);
    expect(openableDemoUrl('https://evil.example/results?search_query=x')).toBeNull();
  });
});

describe('exerciseDemoUrl', () => {
  it('uses the saved video when there is one', () => {
    expect(exerciseDemoUrl('https://youtu.be/dQw4w9WgXcQ', 'Barbell Squat')).toBe(demoUrl('https://youtu.be/dQw4w9WgXcQ'));
  });
  it('falls back to a YouTube search for the exercise when there is no video', () => {
    const want = 'https://www.youtube.com/results?search_query=Barbell%20Squat%20form';
    expect(exerciseDemoUrl(null, 'Barbell Squat')).toBe(want);
    expect(exerciseDemoUrl(undefined, 'Barbell Squat')).toBe(want);
    expect(exerciseDemoUrl('https://evil.example/x', 'Barbell Squat')).toBe(want);
  });
  it('gives nothing without an exercise name', () => {
    expect(exerciseDemoUrl(null, null)).toBeNull();
    expect(exerciseDemoUrl(null, '  ')).toBeNull();
  });
});
