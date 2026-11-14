import { describe, expect, it } from 'vitest';
import { parseListReturn } from './list-return';

describe('parseListReturn', () => {
  it('reads a saved list place', () => {
    expect(parseListReturn('{"url":"/exercises?q=squat","y":640,"shown":100}')).toEqual({ url: '/exercises?q=squat', y: 640, shown: 100 });
  });
  it('ignores anything else, including a link off the Exercises page', () => {
    expect(parseListReturn(null)).toBeNull();
    expect(parseListReturn('not json')).toBeNull();
    expect(parseListReturn('{"url":"https://evil.example/exercises","y":1,"shown":50}')).toBeNull();
    expect(parseListReturn('{"url":"//evil.example","y":1,"shown":50}')).toBeNull();
    expect(parseListReturn('{"url":"/exercises","y":"x","shown":50}')).toBeNull();
  });
});
