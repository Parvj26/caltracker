import { describe, expect, it } from 'vitest';
import { currentTab } from './tab-bar-model';

describe('currentTab', () => {
  it('marks the tab whose page (or a page below it) is open', () => {
    expect(currentTab('/home')).toBe('home');
    expect(currentTab('/clients')).toBe('clients');
    expect(currentTab('/clients/abc/body')).toBe('clients');
    expect(currentTab('/messages')).toBe('messages');
    expect(currentTab('/messages/abc')).toBe('messages');
    expect(currentTab('/programs/p1')).toBe('programs');
  });
  it('marks More for the pages that live in the More sheet', () => {
    for (const path of ['/workouts', '/workouts/new', '/exercises/1', '/meals', '/activity', '/community', '/profile', '/help']) {
      expect(currentTab(path)).toBe('more');
    }
  });
  it('marks nothing elsewhere, and does not match a prefix of another word', () => {
    expect(currentTab('/assign')).toBeNull();
    expect(currentTab('/homework')).toBeNull();
    expect(currentTab('/')).toBeNull();
  });
});
