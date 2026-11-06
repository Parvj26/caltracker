import { notFound } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadClient } from '../../clients/[clientId]/client';
import { Conversation } from '../conversation';
import { loadThread } from '../data';

export default async function ConversationPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { userId, workspaceId } = await requireCoach();
  const { clientId } = await params;
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
    />
  );
}
