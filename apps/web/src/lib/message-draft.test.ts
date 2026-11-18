// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearMessageDrafts, messageDraftKey, readMessageDraft, writeMessageDraft } from './message-draft';

describe('message drafts', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('keeps, reads and removes one conversation’s text', () => {
    const key = messageDraftKey('coach', 'client');
    writeMessageDraft(key, 'Half a thought');
    expect(readMessageDraft(key)).toBe('Half a thought');
    writeMessageDraft(key, '   ');
    expect(readMessageDraft(key)).toBeNull();
  });

  it('clears every message draft on sign-out and leaves other keys alone', () => {
    writeMessageDraft(messageDraftKey('coach', 'a'), 'one');
    writeMessageDraft(messageDraftKey('coach', 'b'), 'two');
    window.sessionStorage.setItem('other', 'x');
    clearMessageDrafts();
    expect(readMessageDraft(messageDraftKey('coach', 'a'))).toBeNull();
    expect(readMessageDraft(messageDraftKey('coach', 'b'))).toBeNull();
    expect(window.sessionStorage.getItem('other')).toBe('x');
  });
});
