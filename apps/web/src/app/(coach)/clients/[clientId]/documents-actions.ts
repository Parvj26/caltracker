'use server';

import { revalidatePath } from 'next/cache';
import { DOCUMENT_MAX_BYTES, validateDocumentName } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// Documents a coach keeps for a client. The browser uploads the file to the private client-documents bucket first
// (storage policies let only the workspace's coach write, for a current client), then createDocument records it.
// The workspace always comes from requireCoach(). Files are removed through the Storage API, never by SQL.

export type DocumentOutcome = { ok: true; warning?: string } | { ok: false; error: string; warning?: string };

const BUCKET = 'client-documents';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: Record<string, string> = { pdf: 'application/pdf', webp: 'image/webp', jpg: 'image/jpeg' };
const GENERIC = "Couldn't save the document. Please try again.";
const refresh = () => revalidatePath('/clients/[clientId]', 'layout');

export type NewDocument = { id: string; clientId: string; name: string; path: string; contentType: string; sizeBytes: number; shared: boolean };

export async function createDocument(input: NewDocument): Promise<DocumentOutcome> {
  const { workspaceId } = await requireCoach();
  const { id, clientId, path, contentType, sizeBytes, shared } = input;
  const prefix = `${workspaceId}/${clientId}/`;
  const ext = typeof path === 'string' ? path.split('.').pop() ?? '' : '';
  const valid =
    UUID.test(id) &&
    UUID.test(clientId) &&
    typeof path === 'string' &&
    path.startsWith(prefix) &&
    UUID.test(path.slice(prefix.length, prefix.length + 36)) &&
    TYPES[ext] === contentType &&
    Number.isInteger(sizeBytes) &&
    sizeBytes > 0 &&
    sizeBytes <= DOCUMENT_MAX_BYTES &&
    typeof shared === 'boolean';
  const supabase = await createServerSupabase();
  const takeBack = async (error: string): Promise<DocumentOutcome> => {
    // The file was uploaded for a record that wasn't made: remove it (only ever inside this client's folder).
    if (typeof path === 'string' && path.startsWith(prefix)) {
      const removed = await supabase.storage.from(BUCKET).remove([path]);
      if (removed.error) return { ok: false, error, warning: 'The uploaded file could not be removed.' };
    }
    return { ok: false, error };
  };
  if (!valid) return takeBack('That file is not a valid document.');
  const name = validateDocumentName(String(input.name ?? ''));
  if (!name.ok) return takeBack(name.error);

  const { error } = await supabase.from('client_documents').insert({
    id,
    workspace_id: workspaceId,
    client_id: clientId,
    name: name.value,
    storage_path: path,
    content_type: contentType,
    size_bytes: sizeBytes,
    shared_with_client: shared,
  });
  if (error) return takeBack(error.code === '42501' ? "This client was removed, so documents can't be added." : GENERIC);
  refresh();
  return { ok: true };
}

export async function renameDocument(id: string, name: string): Promise<DocumentOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id) || typeof name !== 'string') return { ok: false, error: GENERIC };
  const checked = validateDocumentName(name);
  if (!checked.ok) return checked;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('client_documents').update({ name: checked.value }).eq('id', id).eq('workspace_id', workspaceId).select('id');
  if (error || data.length === 0) return { ok: false, error: "Couldn't rename the document." };
  refresh();
  return { ok: true };
}

export async function setDocumentShared(id: string, shared: boolean): Promise<DocumentOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id) || typeof shared !== 'boolean') return { ok: false, error: GENERIC };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('client_documents')
    .update({ shared_with_client: shared })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id');
  if (error || data.length === 0) return { ok: false, error: "Couldn't change sharing. Please try again." };
  refresh();
  return { ok: true };
}

export async function deleteDocument(id: string): Promise<DocumentOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id)) return { ok: false, error: GENERIC };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('client_documents').delete().eq('id', id).eq('workspace_id', workspaceId).select('storage_path');
  if (error) return { ok: false, error: "Couldn't delete the document. Please try again." };
  if (data.length === 0) return { ok: false, error: 'That document is already gone.' };
  refresh();
  const removed = await supabase.storage.from(BUCKET).remove([data[0]!.storage_path]);
  return removed.error ? { ok: true, warning: 'The document is deleted, but its file could not be removed.' } : { ok: true };
}
