import { describe, expect, it } from 'vitest';
import { previousEntryUrl, rememberable } from './history-back';

const nav = (urls: string[], index: number) => ({
  entries: () => urls.map((url) => ({ url })),
  currentEntry: { index },
});

describe('previousEntryUrl', () => {
  it('is the entry Back would go to', () => {
    expect(previousEntryUrl(nav(['https://x.test/home', 'https://x.test/clients?filter=missed', 'https://x.test/clients/a'], 2))?.href).toBe(
      'https://x.test/clients?filter=missed',
    );
  });
  it('is null on the first entry, or where the browser cannot say (no Navigation API)', () => {
    expect(previousEntryUrl(nav(['https://x.test/clients/a'], 0))).toBeNull();
    expect(previousEntryUrl(undefined)).toBeNull();
    expect(previousEntryUrl({ entries: () => [], currentEntry: null })).toBeNull();
  });
  it('ignores entries without an address (another site)', () => {
    expect(previousEntryUrl({ entries: () => [{ url: null }, { url: 'https://x.test/a' }], currentEntry: { index: 1 } })).toBeNull();
  });
});

describe('rememberable', () => {
  it('keeps the view and drops open pop-ups', () => {
    expect(rememberable('/clients/a/training', '?view=week&from=2026-11-02&sheet=assign-x&add=program')).toBe('/clients/a/training?view=week&from=2026-11-02');
    expect(rememberable('/clients', '?scan=1')).toBe('/clients');
    expect(rememberable('/clients', '')).toBe('/clients');
  });
});
