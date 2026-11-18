import { describe, expect, it } from 'vitest';
import { currentTab, isLibraryPath } from './tab-bar-model';

describe('currentTab', () => {
  it('marks the tab whose page (or a page below it) is open', () => {
    expect(currentTab('/home')).toBe('home');
    expect(currentTab('/clients')).toBe('clients');
    expect(currentTab('/clients/abc/body')).toBe('clients');
    expect(currentTab('/messages')).toBe('messages');
    expect(currentTab('/messages/abc')).toBe('messages');
  });
  it('marks Library for workouts, exercises and programs, detail pages included', () => {
    for (const path of ['/workouts', '/workouts/new', '/exercises', '/exercises/1', '/programs', '/programs/p1']) {
      expect(currentTab(path)).toBe('library');
      expect(isLibraryPath(path)).toBe(true);
    }
  });
  it('marks More for the pages that live in the More sheet', () => {
    for (const path of ['/meals', '/activity', '/community', '/profile', '/help']) {
      expect(currentTab(path)).toBe('more');
    }
  });
  it('marks nothing elsewhere, and does not match a prefix of another word', () => {
    expect(currentTab('/assign')).toBeNull();
    expect(currentTab('/homework')).toBeNull();
    expect(currentTab('/programsx')).toBeNull();
    expect(isLibraryPath('/clients')).toBe(false);
    expect(currentTab('/')).toBeNull();
  });
});
