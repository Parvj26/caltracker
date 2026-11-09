import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@caltracker/shared';
import { feedQuery } from './community-feed-query';

const client = createClient<Database>('http://localhost:54321', 'anon-key', { auth: { persistSession: false } });
// The builder keeps the request it will send; read it without sending anything.
const urlOf = (q: unknown) => (q as { url: URL }).url;

describe('feedQuery', () => {
  const url = urlOf(feedQuery(client, 'c1'));

  it('reads the community posts of one community', () => {
    expect(url.pathname).toBe('/rest/v1/community_posts');
    expect(url.searchParams.get('community_id')).toBe('eq.c1');
  });

  it('brings each post’s newest comments, at most two per post', () => {
    expect(url.searchParams.get('select')).toMatch(/recent:community_comments\(id,author_id,body,created_at,author:profiles\(first_name,last_name,avatar_path\)\)/);
    expect(url.searchParams.get('recent.order')).toBe('created_at.desc');
    expect(url.searchParams.get('recent.limit')).toBe('2');
  });

  it('still counts all comments and loads reactions and photos', () => {
    const select = url.searchParams.get('select') ?? '';
    expect(select).toContain('comments:community_comments(count)');
    expect(select).toContain('reactions:community_reactions(');
    expect(select).toContain('images:community_post_images(');
    expect(select).toContain('pinned_by');
  });
});
