import { describe, expect, it } from 'vitest';
import { COMMUNITY_OFFLINE_EMPTY, OFFLINE_PILL_NOTE, OFFLINE_PILL_TEXT, communityOfflineState, offlinePillA11y } from './offline-pill';

describe('offline pill', () => {
  it('reads "Offline" and one short note', () => {
    expect(OFFLINE_PILL_TEXT).toBe('Offline');
    expect(OFFLINE_PILL_NOTE).toBe('Saved on your phone, updates when you’re back online');
  });

  it('tells screen readers the note without a tap, and whether it is open', () => {
    expect(offlinePillA11y(false)).toEqual({
      label: 'Offline. Saved on your phone, updates when you’re back online',
      hint: 'Shows the note under the title',
      expanded: false,
    });
    expect(offlinePillA11y(true).expanded).toBe(true);
    expect(offlinePillA11y(true).hint).toBe('Hides the note');
  });
});

describe('communityOfflineState', () => {
  it('shows the pill only over a saved copy, the empty line when nothing was saved', () => {
    expect(communityOfflineState({ ready: true, offline: true, hasCommunity: true })).toBe('pill');
    expect(communityOfflineState({ ready: true, offline: true, hasCommunity: false })).toBe('empty');
    expect(communityOfflineState({ ready: true, offline: false, hasCommunity: false })).toBeNull();
    expect(communityOfflineState({ ready: false, offline: true, hasCommunity: false })).toBeNull();
    expect(COMMUNITY_OFFLINE_EMPTY).toBe('Offline. The community shows when you’re back online.');
  });
});
