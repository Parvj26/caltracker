import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { getClient } from '@/lib/page-data';
import { clientPageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { DocumentsView, type DocumentRow } from '../../documents-tab/documents-view';

export async function generateMetadata({ params }: { params: Promise<{ clientId: string }> }): Promise<Metadata> {
  return clientPageTitle((await params).clientId, 'Documents');
}

/** Documents the coach keeps for this client, newest first. Links to the files are made only when opened. */
export default async function ClientDocumentsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { workspaceId } = await requireCoach();
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client) notFound();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('client_documents')
    .select('id, name, content_type, size_bytes, shared_with_client, created_at')
    .eq('workspace_id', workspaceId)
    .eq('client_id', client.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not load documents: ${error.message}`);

  const rows: DocumentRow[] = data.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.content_type === 'application/pdf' ? 'PDF' : 'Image',
    sizeBytes: d.size_bytes,
    shared: d.shared_with_client,
    createdAt: d.created_at,
  }));
  return (
    <DocumentsView
      workspaceId={workspaceId}
      client={{ id: client.id, firstName: client.firstName }}
      documents={rows}
      readOnly={client.removedAt !== null}
    />
  );
}
