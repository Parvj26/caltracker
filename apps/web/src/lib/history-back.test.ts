import { describe, expect, it } from 'vitest';
import { previousEntryUrl } from './history-back';

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
