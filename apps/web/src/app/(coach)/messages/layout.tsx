import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadInbox } from './data';
import { MessagesShell } from './inbox';

export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const { userId, workspaceId } = await requireCoach();
  const supabase = await createServerSupabase();
  const rows = await loadInbox(supabase, workspaceId, userId);
  return (
    <MessagesShell rows={rows} userId={userId} workspaceId={workspaceId}>
      {children}
    </MessagesShell>
  );
}
