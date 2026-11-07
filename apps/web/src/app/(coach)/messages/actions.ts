'use server';

import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { MESSAGE_COLUMNS, type MessageInsert, type MessageRow, type NewMessage } from './data';

// Every action starts with requireCoach(). The database does the real authorization: RLS lets a coach post only to a
// conversation of a current client of their workspace, the sender is always the caller, and mark_conversation_read
// refuses (42501) anyone who can't read the conversation.

export type Outcome<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC = "Couldn't send. Please try again.";
const NOT_A_CLIENT = "You can't message this client any more. They may no longer be your client.";

/**
 * Sends a message. Photos are already in storage under `imagePaths`. A repeat of the same `clientMsgId` (a retry)
 * returns the message that was stored the first time.
 */
export async function sendMessage(input: NewMessage): Promise<Outcome<{ message: MessageRow }>> {
  const { userId } = await requireCoach();
  if (typeof input?.body !== 'string' || !Array.isArray(input.image_paths)) return { ok: false, error: GENERIC };
  if (typeof input.conversation_id !== 'string' || !UUID.test(input.conversation_id)) return { ok: false, error: GENERIC };
  if (typeof input.client_msg_id !== 'string' || !UUID.test(input.client_msg_id)) return { ok: false, error: GENERIC };
  if (input.body.length > 4000) return { ok: false, error: 'Messages can be up to 4,000 characters.' };
  if (input.image_paths.length > 4) return { ok: false, error: 'You can send up to 4 photos at a time.' };
  if (input.body.trim() === '' && input.image_paths.length === 0) return { ok: false, error: 'Write a message or add a photo.' };

  const supabase = await createServerSupabase();
  // Only the four columns the database allows; anything else in `input` is dropped.
  const row: NewMessage = {
    conversation_id: input.conversation_id,
    body: input.body,
    image_paths: input.image_paths,
    client_msg_id: input.client_msg_id,
  };
  // workspace_id is required by the generated Insert type, but a trigger copies it from the conversation (no client
  // has the privilege to set it), so the narrow row is cast.
  const { data, error } = await supabase.from('messages').insert(row as MessageInsert).select(MESSAGE_COLUMNS).single();
  if (!error) return { ok: true, message: data };

  if (error.code === '23505') {
    // Already stored by an earlier try of this send.
    const again = await supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('sender_id', userId)
      .eq('client_msg_id', input.client_msg_id)
      .single();
    if (!again.error) return { ok: true, message: again.data };
    return { ok: false, error: GENERIC };
  }
  if (error.code === '42501') return { ok: false, error: NOT_A_CLIENT };
  return { ok: false, error: GENERIC };
}

/** The coach has read the conversation up to now. */
export async function markRead(conversationId: string): Promise<Outcome> {
  await requireCoach();
  if (!UUID.test(conversationId)) return { ok: false, error: GENERIC };
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
  return error ? { ok: false, error: GENERIC } : { ok: true };
}
