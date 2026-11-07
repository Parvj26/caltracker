import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { loadInbox, loadUnreadTotal } from './data';

type Row = Record<string, unknown>;
type Call = { table: string; columns: string; head: boolean };

/** A tiny stand-in for the Supabase query builder: filters rows by eq/neq/gt, orders, limits, counts. */
function fakeDb(tables: Record<string, Row[]>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let head = false;
      let count = false;
      let limit = Infinity;
      const q = {
        select(cols: string, opts?: { count?: string; head?: boolean }) {
          head = opts?.head === true;
          count = opts?.count === 'exact';
          calls.push({ table, columns: cols, head });
          return q;
        },
        eq(col: string, v: unknown) {
          rows = rows.filter((r) => r[col] === v);
          return q;
        },
        neq(col: string, v: unknown) {
          rows = rows.filter((r) => r[col] !== v);
          return q;
        },
        gt(col: string, v: string) {
          rows = rows.filter((r) => Date.parse(r[col] as string) > Date.parse(v));
          return q;
        },
        in(col: string, vs: unknown[]) {
          rows = rows.filter((r) => vs.includes(r[col]));
          return q;
        },
        order(col: string, o: { ascending: boolean }) {
          rows.sort((a, b) => (Date.parse(a[col] as string) - Date.parse(b[col] as string)) * (o.ascending ? 1 : -1));
          return q;
        },
        limit(n: number) {
          limit = n;
          return q;
        },
        then(resolve: (v: unknown) => unknown) {
          const data = rows.slice(0, limit);
          return Promise.resolve(resolve({ data: head ? null : data, count: count ? rows.length : null, error: null }));
        },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, calls };
}

const ME = 'coach';
const WS = 'ws';
const t = (m: number) => new Date(Date.UTC(2026, 10, 5, 10, m)).toISOString();

function world() {
  return {
    workspace_members: [
      { workspace_id: WS, role: 'client', user_id: 'a' },
      { workspace_id: WS, role: 'client', user_id: 'b' },
    ],
    conversations: [
      { id: 'ca', workspace_id: WS, client_id: 'a', last_message_at: t(5) },
      { id: 'cb', workspace_id: WS, client_id: 'b', last_message_at: t(9) },
      // A past client: not a member any more.
      { id: 'cx', workspace_id: WS, client_id: 'gone', last_message_at: t(9) },
    ],
    conversation_reads: [{ conversation_id: 'ca', user_id: ME, last_read_at: t(3) }],
    profiles: [{ id: 'a', full_name: 'Ann A' }, { id: 'b', full_name: 'Bo B' }],
    messages: [
      { conversation_id: 'ca', workspace_id: WS, sender_id: 'a', body: 'old', image_paths: [], created_at: t(1) },
      { conversation_id: 'ca', workspace_id: WS, sender_id: 'a', body: 'new1', image_paths: [], created_at: t(4) },
      { conversation_id: 'ca', workspace_id: WS, sender_id: ME, body: 'mine', image_paths: [], created_at: t(5) },
      { conversation_id: 'cb', workspace_id: WS, sender_id: 'b', body: 'hi', image_paths: [], created_at: t(8) },
      { conversation_id: 'cb', workspace_id: WS, sender_id: 'b', body: 'there', image_paths: [], created_at: t(9) },
      { conversation_id: 'cx', workspace_id: WS, sender_id: 'gone', body: 'bye', image_paths: [], created_at: t(9) },
    ],
  };
}

describe('loadUnreadTotal (the sidebar badge)', () => {
  it('counts the clients\' unread messages and agrees with the inbox rows', async () => {
    const { db } = fakeDb(world());
    const badge = await loadUnreadTotal(db, WS, ME);
    const inbox = await loadInbox(db, WS, ME);
    // a: 1 after the read mark (the old one and my own do not count); b: 2 (never read); the past client: none.
    expect(badge).toBe(3);
    expect(inbox.reduce((n, r) => n + r.unread, 0)).toBe(badge);
  });

  it('never reads message bodies or photo paths, and never loads my own messages', async () => {
    const { db, calls } = fakeDb(world());
    await loadUnreadTotal(db, WS, ME);
    const messageReads = calls.filter((c) => c.table === 'messages');
    expect(messageReads.length).toBeGreaterThan(0);
    for (const c of messageReads) {
      expect(c.columns).not.toMatch(/body|image_paths/);
    }
    expect(messageReads[0]!.columns).toBe('conversation_id, sender_id, created_at');
  });

  it('is 0 with no current clients', async () => {
    const w = world();
    w.workspace_members = [];
    expect(await loadUnreadTotal(fakeDb(w).db, WS, ME)).toBe(0);
  });

  it('bounds the read to messages newer than the oldest read mark when every conversation has one', async () => {
    const w = world();
    w.conversation_reads.push({ conversation_id: 'cb', user_id: ME, last_read_at: t(8) });
    const { db } = fakeDb(w);
    // a: 1 (t4 after t3), b: 1 (t9 after t8).
    expect(await loadUnreadTotal(db, WS, ME)).toBe(2);
    expect((await loadInbox(db, WS, ME)).reduce((n, r) => n + r.unread, 0)).toBe(2);
  });

  it('counts exactly when the window is full, never undercounting', async () => {
    const w = world();
    const many = Array.from({ length: 1000 }, (_, i) => ({
      conversation_id: 'ca',
      workspace_id: WS,
      sender_id: 'a',
      body: '',
      image_paths: [],
      created_at: new Date(Date.UTC(2026, 10, 5, 11, 0, 0, i)).toISOString(),
    }));
    w.messages.push(...many);
    const { db } = fakeDb(w);
    // a: 1 + 1000 unread, b: 2.
    expect(await loadUnreadTotal(db, WS, ME)).toBe(1003);
  });
});
