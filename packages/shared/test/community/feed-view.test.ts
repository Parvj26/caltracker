import { describe, expect, it } from 'vitest';
import {
  coachFilterLabel,
  commentCountLabel,
  commentPreview,
  communitySubtitle,
  filterFeed,
  pinnedByLabel,
  reactionCountLabel,
  viewAllCommentsLabel,
} from '../../src';

const post = (id: string, authorId: string, card: unknown = null) => ({ id, authorId, card });

describe('filterFeed', () => {
  const posts = [post('1', 'coach'), post('2', 'sam', { kind: 'pr' }), post('3', 'maya'), post('4', 'coach', { kind: 'sticker' })];
  const coaches = new Set(['coach']);

  it('keeps everything for All', () => {
    expect(filterFeed(posts, 'all', coaches).map((p) => p.id)).toEqual(['1', '2', '3', '4']);
  });
  it('keeps only coach posts for the coach filter', () => {
    expect(filterFeed(posts, 'coach', coaches).map((p) => p.id)).toEqual(['1', '4']);
  });
  it('keeps only posts carrying a shared card for Wins', () => {
    expect(filterFeed(posts, 'wins', coaches).map((p) => p.id)).toEqual(['2', '4']);
  });
  it('does not change the input', () => {
    filterFeed(posts, 'wins', coaches);
    expect(posts).toHaveLength(4);
  });
});

describe('coachFilterLabel', () => {
  it('names the only coach by first name', () => {
    expect(coachFilterLabel(['Luis Bueno'])).toBe('From Luis');
  });
  it('falls back when the name is unknown', () => {
    expect(coachFilterLabel([])).toBe('From your coach');
    expect(coachFilterLabel(['Former member'])).toBe('From your coach');
  });
  it('says coaches when there are several', () => {
    expect(coachFilterLabel(['Luis Bueno', 'Ana Ruiz'])).toBe('From coaches');
  });
});

describe('commentPreview', () => {
  const c = (id: string, authorId: string, createdAt: string) => ({ id, authorId, createdAt });
  const comments = [c('a', 'sam', '2026-11-01T10:00:00Z'), c('b', 'maya', '2026-11-03T10:00:00Z'), c('c', 'luis', '2026-11-02T10:00:00Z')];

  it('picks the two most recent, oldest of them first', () => {
    expect(commentPreview(comments, new Set()).map((x) => x.id)).toEqual(['c', 'b']);
  });
  it('leaves out blocked members', () => {
    expect(commentPreview(comments, new Set(['maya'])).map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('takes a custom size', () => {
    expect(commentPreview(comments, new Set(), 1).map((x) => x.id)).toEqual(['b']);
  });
  it('is empty without comments', () => {
    expect(commentPreview([], new Set())).toEqual([]);
  });
});

describe('labels', () => {
  it('viewAllCommentsLabel', () => {
    expect(viewAllCommentsLabel(0)).toBeNull();
    expect(viewAllCommentsLabel(1)).toBe('View 1 comment');
    expect(viewAllCommentsLabel(9)).toBe('View all 9 comments');
  });
  it('commentCountLabel and reactionCountLabel', () => {
    expect(commentCountLabel(0)).toBe('0 comments');
    expect(commentCountLabel(1)).toBe('1 comment');
    expect(commentCountLabel(5)).toBe('5 comments');
    expect(reactionCountLabel(1)).toBe('1 reaction');
    expect(reactionCountLabel(8)).toBe('8 reactions');
  });
  it('communitySubtitle', () => {
    expect(communitySubtitle('Luis Bueno Coaching', 18)).toBe('Luis Bueno Coaching · 18 members');
    expect(communitySubtitle('Luis Bueno Coaching', 1)).toBe('Luis Bueno Coaching · 1 member');
    expect(communitySubtitle('Luis Bueno Coaching', null)).toBe('Luis Bueno Coaching');
    expect(communitySubtitle('', 4)).toBe('4 members');
    expect(communitySubtitle(null, null)).toBe('');
  });
  it('pinnedByLabel', () => {
    expect(pinnedByLabel('Luis Bueno')).toBe('Pinned by Luis');
    expect(pinnedByLabel(null)).toBe('Pinned');
    expect(pinnedByLabel('Former member')).toBe('Pinned');
  });
});
