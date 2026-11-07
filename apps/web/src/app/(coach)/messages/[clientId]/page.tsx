import { notFound } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadClient } from '../../clients/[clientId]/client';
import { Conversation } from '../conversation';
import { loadThread } from '../data';

/** `?about=` pre-fills the reply box (the Food tab's "Reply about this meal"); it is only ever text the coach can edit. */
export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ about?: string | string[] }>;
}) {
  const { userId, workspaceId } = await requireCoach();
  const [{ clientId }, query] = await Promise.all([params, searchParams]);
  const about = typeof query.about === 'string' ? query.about.slice(0, 200) : undefined;
  const supabase = await createServerSupabase();
  const client = await loadClient(supabase, workspaceId, clientId);
  if (!client) notFound();
  const thread = await loadThread(supabase, workspaceId, userId, client);
  return (
    <Conversation
      key={client.id}
      conversationId={thread.conversationId}
      workspaceId={workspaceId}
      me={userId}
      clientId={client.id}
      clientName={client.name}
      rows={thread.rows}
      theirReadAt={thread.theirReadAt}
      readOnly={client.removedAt !== null}
      initialBody={about}
    />
  );
}
