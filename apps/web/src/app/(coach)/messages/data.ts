import type { SupabaseClient } from '@supabase/supabase-js';
import { unreadCount, type Database, type Message } from '@caltracker/shared';
import { buildInbox, type InboxRow } from './model';

type Db = SupabaseClient<Database>;
export type MessageInsert = Database['public']['Tables']['messages']['Insert'];

/**
 * The only columns a client may set when sending (the database gives the others no privilege: the sender is the
 * caller, the workspace comes from the conversation).
 */
export type NewMessage = Pick<MessageInsert, 'conversation_id' | 'body' | 'image_paths' | 'client_msg_id'>;

export const MESSAGE_COLUMNS = 'id, sender_id, body, image_paths, client_msg_id, created_at';
export type MessageRow = Pick<Database['public']['Tables']['messages']['Row'], 'id' | 'sender_id' | 'body' | 'image_paths' | 'client_msg_id' | 'created_at'>;

export const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  senderId: r.sender_id,
  body: r.body,
  imagePaths: r.image_paths,
  clientMsgId: r.client_msg_id,
  createdAt: r.created_at,
});

/** How many recent messages the inbox looks at to find previews and unread counts. */
const RECENT_LIMIT = 1000;
/**
 * The newest messages loaded alongside the first queries (small: it is wasted in a busy workspace). A reply shorter
 * than this is taken as "that's every message", which relies on PostgREST's max_rows being at least 200 (it is 1000
 * in supabase/config.toml and on staging). A lower cap would cut the reply short and undercount.
 */
const QUICK_LIMIT = 200;

/** The thread shows this many latest messages first; "Show earlier messages" loads another page. */
export const PAGE_SIZE = 100;

/** Messages of a conversation, newest first (so a page can be taken from the end). */
export async function loadMessages(supabase: Db, conversationId: string, before?: string): Promise<MessageRow[]> {
  let q = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  // lte, not lt: messages sharing the page's oldest timestamp must not be skipped (the caller drops repeats).
  if (before) q = q.lte('created_at', before);
  const { data, error } = await q;
  if (error) throw new Error(`Could not load messages: ${error.message}`);
  return data;
}

/** The other person's (the client's) last_read_at for a conversation, or null. */
export async function loadTheirRead(supabase: Db, conversationId: string, clientId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('conversation_reads')
    .select('last_read_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', clientId)
    .maybeSingle();
  if (error) throw new Error(`Could not load read state: ${error.message}`);
  return data?.last_read_at ?? null;
}

type Latest = { body: string; imagePaths: string[]; senderId: string };
type Stamped = { senderId: string; createdAt: string };

/**
 * What the inbox and the sidebar badge both read, so they always agree: the workspace's current clients and
 * conversations, the coach's reads, previews and recent messages (the latest RECENT_LIMIT), and exact unread counts
 * for conversations whose messages are all older than that window.
 */
async function loadActivity(supabase: Db, workspaceId: string, me: string) {
  const [members, conversations, reads, recent] = await Promise.all([
    supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'client'),
    supabase.from('conversations').select('id, client_id, last_message_at').eq('workspace_id', workspaceId),
    supabase.from('conversation_reads').select('conversation_id, last_read_at').eq('user_id', me),
    supabase
      .from('messages')
      .select('conversation_id, sender_id, body, image_paths, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT),
  ]);
  if (members.error) throw new Error(`Could not load clients: ${members.error.message}`);
  if (conversations.error) throw new Error(`Could not load conversations: ${conversations.error.message}`);
  if (reads.error) throw new Error(`Could not load read state: ${reads.error.message}`);
  if (recent.error) throw new Error(`Could not load messages: ${recent.error.message}`);

  const clientIds = members.data.map((m) => m.user_id);
  const latest = new Map<string, Latest>();
  const recentBy = new Map<string, Stamped[]>();
  for (const m of recent.data) {
    // Newest first, so the first one seen per conversation is its latest.
    if (!latest.has(m.conversation_id)) latest.set(m.conversation_id, { body: m.body, imagePaths: m.image_paths, senderId: m.sender_id });
    const list = recentBy.get(m.conversation_id) ?? [];
    list.push({ senderId: m.sender_id, createdAt: m.created_at });
    recentBy.set(m.conversation_id, list);
  }
  const readAt = new Map(reads.data.map((r) => [r.conversation_id, r.last_read_at]));

  // A conversation whose messages are all older than the recent window still needs a preview and an unread count.
  const current = new Set(clientIds);
  const missing = conversations.data.filter((c) => current.has(c.client_id) && c.last_message_at !== null && !latest.has(c.id));
  const unreadOverride = new Map<string, number>();
  await Promise.all(
    missing.map(async (c) => {
      const [last, count] = await Promise.all([
        supabase
          .from('messages')
          .select('body, image_paths, sender_id')
          .eq('conversation_id', c.id)
          .order('created_at', { ascending: false })
          .limit(1),
        exactUnread(supabase, c.id, me, readAt.get(c.id) ?? null),
      ]);
      if (last.error) throw new Error(`Could not load messages: ${last.error.message}`);
      const row = last.data[0];
      if (row) latest.set(c.id, { body: row.body, imagePaths: row.image_paths, senderId: row.sender_id });
      unreadOverride.set(c.id, count);
    }),
  );
  return { clientIds, conversations: conversations.data, latest, recentBy, readAt, unreadOverride };
}

/** Exact unread count of one conversation (the other person's messages after my last read), counted by the database. */
async function exactUnread(supabase: Db, conversationId: string, me: string, readAt: string | null): Promise<number> {
  let q = supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).neq('sender_id', me);
  if (readAt) q = q.gt('created_at', readAt);
  const { count, error } = await q;
  if (error) throw new Error(`Could not count unread messages: ${error.message}`);
  return count ?? 0;
}

/**
 * Unread messages across the coach's current clients (the sidebar badge, loaded on every dashboard page). It uses
 * the same rule as the inbox rows (unreadCount: the other person's messages after my last read, current clients
 * only) but a lean read: three small queries plus one of (conversation_id, sender_id, created_at) for the clients'
 * messages newer than the oldest read mark, never the bodies. If that window is full, the conversations in it are
 * counted exactly by the database instead, so the badge never undercounts. Works with the server or browser client.
 * It runs on every page load, so the newest QUICK_LIMIT messages are fetched in the same round as the three small
 * queries: in a workspace with fewer than that, they are the whole story and the badge costs one round trip.
 */
export async function loadUnreadTotal(supabase: Db, workspaceId: string, me: string): Promise<number> {
  const recentFrom = (limit: number, after: string | null) => {
    let q = supabase
      .from('messages')
      .select('conversation_id, sender_id, created_at')
      .eq('workspace_id', workspaceId)
      .neq('sender_id', me)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (after !== null) q = q.gt('created_at', after);
    return q;
  };
  const [members, conversations, reads, quick] = await Promise.all([
    supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'client'),
    supabase.from('conversations').select('id, client_id').eq('workspace_id', workspaceId),
    supabase.from('conversation_reads').select('conversation_id, last_read_at').eq('user_id', me),
    recentFrom(QUICK_LIMIT, null),
  ]);
  if (members.error) throw new Error(`Could not load clients: ${members.error.message}`);
  if (conversations.error) throw new Error(`Could not load conversations: ${conversations.error.message}`);
  if (reads.error) throw new Error(`Could not load read state: ${reads.error.message}`);

  const current = new Set(members.data.map((m) => m.user_id));
  // Past clients' conversations stay readable but never count.
  const live = conversations.data.filter((c) => current.has(c.client_id));
  if (live.length === 0) return 0;
  const readAt = new Map(reads.data.map((r) => [r.conversation_id, r.last_read_at]));

  // Nothing older than the oldest read mark can be unread (and a conversation never read has no such bound).
  let bound: string | null = null;
  for (const c of live) {
    const r = readAt.get(c.id);
    if (!r) {
      bound = null;
      break;
    }
    if (bound === null || Date.parse(r) < Date.parse(bound)) bound = r;
  }
  // Fewer than QUICK_LIMIT messages in the workspace: the quick look already holds every one (unreadCount below
  // ignores the read ones). Otherwise read the bounded window as before.
  if (quick.error) throw new Error(`Could not load messages: ${quick.error.message}`);
  const recent = quick.data.length < QUICK_LIMIT ? quick : await recentFrom(RECENT_LIMIT, bound);
  if (recent.error) throw new Error(`Could not load messages: ${recent.error.message}`);

  const by = new Map<string, Stamped[]>();
  for (const m of recent.data) {
    const list = by.get(m.conversation_id) ?? [];
    list.push({ senderId: m.sender_id, createdAt: m.created_at });
    by.set(m.conversation_id, list);
  }
  // A full window may hide older unread messages (and conversations missing from it may have some), so then the
  // database counts every conversation exactly. Otherwise the rows we have are the whole story.
  const truncated = recent.data.length >= RECENT_LIMIT;
  const counts = await Promise.all(
    live.map((c) => {
      const read = readAt.get(c.id) ?? null;
      if (truncated) return exactUnread(supabase, c.id, me, read);
      return Promise.resolve(unreadCount(by.get(c.id) ?? [], me, read));
    }),
  );
  return counts.reduce((a, b) => a + b, 0);
}

/** Every current client as an inbox row (server side; names come from profiles). */
export async function loadInbox(supabase: Db, workspaceId: string, me: string): Promise<InboxRow[]> {
  const a = await loadActivity(supabase, workspaceId, me);
  const profiles = a.clientIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', a.clientIds)
    : { data: [], error: null };
  if (profiles.error) throw new Error(`Could not load client names: ${profiles.error.message}`);
  const nameOf = new Map(profiles.data.map((p) => [p.id, p.full_name]));
  return buildInbox({
    me,
    clients: a.clientIds.map((id) => ({ id, name: nameOf.get(id) || 'Client' })),
    conversations: a.conversations.map((c) => ({ id: c.id, clientId: c.client_id, lastMessageAt: c.last_message_at })),
    latest: a.latest,
    recent: a.recentBy,
    reads: a.readAt,
    unreadOverride: a.unreadOverride,
  });
}

/** What a conversation page needs: the conversation (created on first use for a current client) and its latest messages. */
export async function loadThread(
  supabase: Db,
  workspaceId: string,
  me: string,
  client: { id: string; removedAt: string | null },
): Promise<{ conversationId: string | null; rows: MessageRow[]; theirReadAt: string | null }> {
  let conversationId: string | null;
  if (client.removedAt !== null) {
    // A past client can no longer be a conversation's other side, so nothing is created: read what exists.
    const { data, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('client_id', client.id)
      .maybeSingle();
    if (error) throw new Error(`Could not load the conversation: ${error.message}`);
    conversationId = data?.id ?? null;
  } else {
    const { data, error } = await supabase.rpc('get_or_create_conversation', { p_client_id: client.id });
    if (error) throw new Error(`Could not open the conversation: ${error.message}`);
    conversationId = data;
  }
  if (!conversationId) return { conversationId: null, rows: [], theirReadAt: null };
  const [rows, theirReadAt] = await Promise.all([loadMessages(supabase, conversationId), loadTheirRead(supabase, conversationId, client.id)]);
  return { conversationId, rows, theirReadAt };
}
