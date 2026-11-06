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

/** The other person's last_read_at for a conversation, or null. */
export async function loadTheirRead(supabase: Db, conversationId: string, me: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('conversation_reads')
    .select('last_read_at')
    .eq('conversation_id', conversationId)
    .neq('user_id', me)
    .maybeSingle();
  if (error) throw new Error(`Could not load read state: ${error.message}`);
  return data?.last_read_at ?? null;
}

/** Unread messages across the coach's current clients (the sidebar badge). Works with the server or browser client. */
export async function loadUnreadTotal(supabase: Db, me: string): Promise<number> {
  const [members, conversations, reads, recent] = await Promise.all([
    supabase.from('workspace_members').select('user_id').eq('role', 'client'),
    supabase.from('conversations').select('id, client_id'),
    supabase.from('conversation_reads').select('conversation_id, last_read_at').eq('user_id', me),
    supabase
      .from('messages')
      .select('conversation_id, sender_id, created_at')
      .neq('sender_id', me)
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT),
  ]);
  for (const r of [members, conversations, reads, recent]) {
    if (r.error) throw new Error(`Could not count unread messages: ${r.error.message}`);
  }
  const current = new Set(members.data!.map((m) => m.user_id));
  const readAt = new Map(reads.data!.map((r) => [r.conversation_id, r.last_read_at]));
  const byConversation = new Map<string, { senderId: string; createdAt: string }[]>();
  for (const m of recent.data!) {
    const list = byConversation.get(m.conversation_id) ?? [];
    list.push({ senderId: m.sender_id, createdAt: m.created_at });
    byConversation.set(m.conversation_id, list);
  }
  let total = 0;
  for (const c of conversations.data!) {
    // Past clients' conversations stay readable but never count.
    if (!current.has(c.client_id)) continue;
    total += unreadCount(byConversation.get(c.id) ?? [], me, readAt.get(c.id) ?? null);
  }
  return total;
}

/** Every current client as an inbox row (server side; names come from profiles). */
export async function loadInbox(supabase: Db, workspaceId: string, me: string): Promise<InboxRow[]> {
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

  const ids = members.data.map((m) => m.user_id);
  const profiles = ids.length
    ? await supabase.from('profiles').select('id, full_name').in('id', ids)
    : { data: [], error: null };
  if (profiles.error) throw new Error(`Could not load client names: ${profiles.error.message}`);
  const nameOf = new Map(profiles.data.map((p) => [p.id, p.full_name]));
  const clients = ids.map((id) => ({ id, name: nameOf.get(id) || 'Client' }));

  const latest = new Map<string, { body: string; imagePaths: string[]; senderId: string }>();
  const recentBy = new Map<string, { senderId: string; createdAt: string }[]>();
  for (const m of recent.data) {
    // Newest first, so the first one seen per conversation is its latest.
    if (!latest.has(m.conversation_id)) latest.set(m.conversation_id, { body: m.body, imagePaths: m.image_paths, senderId: m.sender_id });
    const list = recentBy.get(m.conversation_id) ?? [];
    list.push({ senderId: m.sender_id, createdAt: m.created_at });
    recentBy.set(m.conversation_id, list);
  }
  const readAt = new Map(reads.data.map((r) => [r.conversation_id, r.last_read_at]));

  // A conversation whose messages are all older than the recent window still needs a preview and an unread count.
  const current = new Set(ids);
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
        (() => {
          let q = supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', c.id).neq('sender_id', me);
          const read = readAt.get(c.id);
          if (read) q = q.gt('created_at', read);
          return q;
        })(),
      ]);
      if (last.error) throw new Error(`Could not load messages: ${last.error.message}`);
      if (count.error) throw new Error(`Could not count unread messages: ${count.error.message}`);
      const row = last.data[0];
      if (row) latest.set(c.id, { body: row.body, imagePaths: row.image_paths, senderId: row.sender_id });
      unreadOverride.set(c.id, count.count ?? 0);
    }),
  );

  return buildInbox({
    me,
    clients,
    conversations: conversations.data.map((c) => ({ id: c.id, clientId: c.client_id, lastMessageAt: c.last_message_at })),
    latest,
    recent: recentBy,
    reads: readAt,
    unreadOverride,
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
  const [rows, theirReadAt] = await Promise.all([loadMessages(supabase, conversationId), loadTheirRead(supabase, conversationId, me)]);
  return { conversationId, rows, theirReadAt };
}
