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

const SIGNED_FOR_S = 3600;

/** Documents the coach keeps for this client, newest first, each with a link that works for an hour. */
export default async function ClientDocumentsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { workspaceId } = await requireCoach();
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client) notFound();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('client_documents')
    .select('id, name, storage_path, content_type, size_bytes, shared_with_client, created_at')
    .eq('workspace_id', workspaceId)
    .eq('client_id', client.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not load documents: ${error.message}`);

  const urls = new Map<string, string>();
  if (data.length > 0) {
    const signed = await supabase.storage.from('client-documents').createSignedUrls(data.map((d) => d.storage_path), SIGNED_FOR_S);
    if (signed.error) throw new Error(`Could not load document links: ${signed.error.message}`);
    for (const s of signed.data) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const rows: DocumentRow[] = data.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.content_type === 'application/pdf' ? 'PDF' : 'Image',
    sizeBytes: d.size_bytes,
    shared: d.shared_with_client,
    createdAt: d.created_at,
    url: urls.get(d.storage_path) ?? null,
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
