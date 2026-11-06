// Server calls for the Coach tab. RLS limits everything to the signed-in client's own conversation while they are
// still a client. Writes are the narrow message insert and mark_conversation_read; nothing else.
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { randomUUID } from 'expo-crypto';
import { isAlreadyUploaded, photoPaths, type Database, type Message } from '@caltracker/shared';
import { isNetworkFailure } from './network-failure';
import { OutboxSendError, type OutboxEntry } from './outbox';
import { supabase } from './supabase';

type MessageInsert = Database['public']['Tables']['messages']['Insert'];
type MessageRow = Database['public']['Tables']['messages']['Row'];
/** The only columns a client may set when sending (the database gives the others no privilege). */
export type NewMessage = Pick<MessageInsert, 'conversation_id' | 'body' | 'image_paths' | 'client_msg_id'>;
export type MessageRowLite = Pick<MessageRow, 'id' | 'sender_id' | 'body' | 'image_paths' | 'client_msg_id' | 'created_at'>;

export const MESSAGE_COLUMNS = 'id, sender_id, body, image_paths, client_msg_id, created_at';
export const BUCKET = 'message-images';
/** Latest messages loaded for the thread and the unread badge. */
export const PAGE_SIZE = 100;
export const SIGNED_URL_SECONDS = 3600;

export const toMessage = (r: MessageRowLite): Message => ({
  id: r.id,
  senderId: r.sender_id,
  body: r.body,
  imagePaths: r.image_paths,
  clientMsgId: r.client_msg_id,
  createdAt: r.created_at,
});

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('You are signed out. Sign in again.');
  return id;
}

/** The conversation with my coach, created on first use. Null when I am not a client of anyone. */
export async function openConversation(): Promise<string | null> {
  const me = await myId();
  const { data, error } = await supabase.rpc('get_or_create_conversation', { p_client_id: me });
  if (error) {
    if (error.code === '42501') return null;
    throw new Error(`Could not open the conversation: ${error.message}`);
  }
  return data;
}

/** Messages of a conversation, newest first. */
export async function loadMessages(conversationId: string): Promise<MessageRowLite[]> {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw new Error(`Could not load messages: ${error.message}`);
  return data;
}

/** Older messages than `before` (inclusive: the caller drops repeats), newest first. */
export async function loadEarlier(conversationId: string, before: string): Promise<MessageRowLite[]> {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .lte('created_at', before)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw new Error(`Could not load messages: ${error.message}`);
  return data;
}

/** last_read_at of each side: mine and the coach's. */
export async function loadReads(conversationId: string, me: string): Promise<{ mine: string | null; theirs: string | null }> {
  const { data, error } = await supabase
    .from('conversation_reads')
    .select('user_id, last_read_at')
    .eq('conversation_id', conversationId);
  if (error) throw new Error(`Could not load read state: ${error.message}`);
  return {
    mine: data.find((r) => r.user_id === me)?.last_read_at ?? null,
    theirs: data.find((r) => r.user_id !== me)?.last_read_at ?? null,
  };
}

export async function markRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
  if (error) throw new Error(`Could not mark read: ${error.message}`);
}

/** Reads a local file as bytes (a file:// URI from the photo picker or compressor). */
async function bytesOf(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  return res.arrayBuffer();
}

async function uploadPhoto(path: string, uri: string, contentType: string): Promise<void> {
  let body: ArrayBuffer;
  try {
    body = await bytesOf(uri);
  } catch {
    throw new OutboxSendError('photo', "Couldn't read the photo. Please choose it again.");
  }
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: false });
  // A retry finds the photo already there: that is a success.
  if (error && !isAlreadyUploaded(error)) {
    // No signal keeps the message "Sending…" (it goes out when the phone reconnects); anything else needs a tap on Retry.
    if (isNetworkFailure(error)) throw new OutboxSendError('network', error.message);
    throw new OutboxSendError('photo', "Couldn't upload the photo. Please try again.");
  }
}

/**
 * Inserts the message. A send that hits the unique (sender, client_msg_id) is a repeat of an earlier try: the
 * stored row is read back instead. Throws OutboxSendError('network' | 'refused').
 */
export async function insertMessage(row: NewMessage, me: string): Promise<MessageRowLite> {
  // workspace_id is required by the generated Insert type, but a trigger copies it from the conversation (no client
  // has the privilege to set it), so the narrow row is cast.
  const { data, error } = await supabase.from('messages').insert(row as MessageInsert).select(MESSAGE_COLUMNS).single();
  if (!error) return data;
  if (error.code === '23505') {
    const again = await supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('sender_id', me)
      .eq('client_msg_id', row.client_msg_id as string)
      .single();
    if (!again.error) return again.data;
    if (isNetworkFailure(again.error)) throw new OutboxSendError('network', again.error.message);
    throw new OutboxSendError('refused', "Couldn't send. Please try again.");
  }
  if (isNetworkFailure(error)) throw new OutboxSendError('network', error.message);
  if (error.code === '42501') throw new OutboxSendError('refused', "You can't message your coach any more.");
  throw new OutboxSendError('refused', "Couldn't send. Please try again.");
}

/** Uploads an entry's photos (full + thumbnail), then inserts the message. Safe to repeat. */
export async function sendEntry(entry: OutboxEntry, workspaceId: string): Promise<MessageRowLite> {
  const me = await myId().catch(() => {
    throw new OutboxSendError('refused', 'You are signed out. Sign in again.');
  });
  const imagePaths: string[] = [];
  for (const p of entry.photos) {
    const target = photoPaths(workspaceId, entry.conversationId, p.id, p.ext);
    const type = p.ext === 'webp' ? 'image/webp' : 'image/jpeg';
    try {
      await uploadPhoto(target.full, p.fullUri, type);
      await uploadPhoto(target.thumb, p.thumbUri, type);
    } catch (e) {
      // A dropped connection stays 'network' (still Sending…); only a photo that will not upload becomes Didn't send.
      throw e instanceof OutboxSendError ? e : new OutboxSendError('photo', "Couldn't upload the photo. Please try again.");
    }
    imagePaths.push(target.full);
  }
  return insertMessage(
    { conversation_id: entry.conversationId, body: entry.body, image_paths: imagePaths, client_msg_id: entry.clientMsgId },
    me,
  );
}

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const item of data) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}

export type ChangeSpec = { table: 'messages' | 'conversation_reads'; filter: string };

/**
 * Joins a Realtime channel and returns the function that leaves it. Every call uses its own unique topic: the client
 * is shared, and a channel that is still leaving (a quick remount) would otherwise be handed back by name, the new
 * subscribe would do nothing, and the pending removal would then kill the live updates for good.
 */
export function subscribeChanges(
  channelName: string,
  specs: ChangeSpec[],
  handlers: { onChange: (table: ChangeSpec['table'], row: Record<string, unknown>) => void; onReady?: (() => void) | undefined },
): () => void {
  let channel = supabase.channel(`${channelName}:${randomUUID()}`);
  for (const spec of specs) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: spec.table, filter: spec.filter },
      (payload) => handlers.onChange(spec.table, payload.new as Record<string, unknown>),
    );
  }
  channel.subscribe((status) => {
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) handlers.onReady?.();
  });
  return () => {
    void supabase.removeChannel(channel);
  };
}
