import { describe, expect, it } from 'vitest';
import { canonicalYoutubeUrl, parseYoutubeUrl, youtubeFormSearchUrl } from '../../src/exercises/youtube';

describe('youtubeFormSearchUrl', () => {
  it('builds an encoded search url', () => {
    expect(youtubeFormSearchUrl('Barbell Squat')).toBe(
      'https://www.youtube.com/results?search_query=Barbell%20Squat%20form',
    );
  });
  it('encodes special characters', () => {
    expect(youtubeFormSearchUrl('3/4 Sit-Up & Co')).toBe(
      'https://www.youtube.com/results?search_query=3%2F4%20Sit-Up%20%26%20Co%20form',
    );
  });
});

describe('parseYoutubeUrl', () => {
  it.each([
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
    'https://youtube.com/shorts/dQw4w9WgXcQ',
    'm.youtube.com/watch?v=dQw4w9WgXcQ',
    'youtu.be/dQw4w9WgXcQ?si=abc',
    'http://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
    '  https://youtu.be/dQw4w9WgXcQ  ',
  ])('accepts %s', (url) => {
    expect(parseYoutubeUrl(url)).toEqual({ videoId: 'dQw4w9WgXcQ' });
  });

  it.each([
    'https://vimeo.com/1',
    'https://evil.com/?v=dQw4w9WgXcQ',
    'not a url',
    '',
    'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=short',
    'https://youtube.com/watch',
    'javascript:alert(1)',
    'https://youtube.com/channel/dQw4w9WgXcQ',
  ])('rejects %s', (url) => {
    expect(parseYoutubeUrl(url)).toBeNull();
  });
});

describe('canonicalYoutubeUrl', () => {
  it('builds the https watch url', () => {
    expect(canonicalYoutubeUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
});
