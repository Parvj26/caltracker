'use server';

import { revalidatePath } from 'next/cache';
import { DOCUMENT_MAX_BYTES, codeForMessage, validateDocumentName, type ErrorCode } from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// Documents a coach keeps for a client. The browser uploads the file to the private client-documents bucket first
// (storage policies let only the workspace's coach write, for a current client), then createDocument records it.
// The workspace always comes from requireCoach(). Files are removed through the Storage API, never by SQL.

export type DocumentOutcome = { ok: true; warning?: string } | (ActionFailure & { warning?: string });

const BUCKET = 'client-documents';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: Record<string, string> = { pdf: 'application/pdf', webp: 'image/webp', jpg: 'image/jpeg' };
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
  const takeBack = async (code: ErrorCode): Promise<DocumentOutcome> => {
    const failed = fail(code, 'action:documents.createDocument');
    // The file was uploaded for a record that wasn't made: remove it (only ever inside this client's folder).
    if (typeof path === 'string' && path.startsWith(prefix)) {
      const removed = await supabase.storage.from(BUCKET).remove([path]);
      if (removed.error) return { ...failed, warning: 'The uploaded file could not be removed.' };
    }
    return failed;
  };
  if (!valid) return takeBack('document_invalid');
  const name = validateDocumentName(String(input.name ?? ''));
  if (!name.ok) return takeBack(codeForMessage(name.error, 'field_format'));

  // Trust what Storage holds, not what the browser said: the size and type must match the uploaded object.
  const fileName = path.slice(prefix.length);
  const listed = await supabase.storage.from(BUCKET).list(`${workspaceId}/${clientId}`, { search: fileName, limit: 1 });
  if (listed.error) return fail('document_save_failed', 'action:documents.createDocument');
  const stored = listed.data.find((o) => o.name === fileName);
  const meta = (stored?.metadata ?? {}) as { size?: unknown; mimetype?: unknown };
  if (!stored || meta.size !== sizeBytes || meta.mimetype !== contentType) {
    return takeBack('document_upload_mismatch');
  }

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
  if (error) return takeBack(error.code === '42501' ? 'document_client_removed' : 'document_save_failed');
  refresh();
  return { ok: true };
}

const LINK_FOR_S = 300;

/** A short-lived link (5 minutes) to open one document, made when the coach asks for it. */
export async function documentLink(id: string): Promise<{ ok: true; url: string } | ActionFailure> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id)) return fail('document_save_failed', 'action:documents.documentLink');
  const supabase = await createServerSupabase();
  const row = await supabase.from('client_documents').select('storage_path').eq('id', id).eq('workspace_id', workspaceId).maybeSingle();
  if (row.error) return fail('document_open_failed', 'action:documents.documentLink');
  if (!row.data) return fail('document_gone', 'action:documents.documentLink');
  const signed = await supabase.storage.from(BUCKET).createSignedUrl(row.data.storage_path, LINK_FOR_S);
  if (signed.error) return fail('document_open_failed', 'action:documents.documentLink');
  return { ok: true, url: signed.data.signedUrl };
}

export async function renameDocument(id: string, name: string): Promise<DocumentOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id) || typeof name !== 'string') return fail('document_save_failed', 'action:documents.renameDocument');
  const checked = validateDocumentName(name);
  if (!checked.ok) return fail(codeForMessage(checked.error, 'field_format'), 'action:documents.renameDocument');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('client_documents').update({ name: checked.value }).eq('id', id).eq('workspace_id', workspaceId).select('id');
  if (error || data.length === 0) return fail('document_rename_failed', 'action:documents.renameDocument');
  refresh();
  return { ok: true };
}

export async function setDocumentShared(id: string, shared: boolean): Promise<DocumentOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id) || typeof shared !== 'boolean') return fail('document_save_failed', 'action:documents.setDocumentShared');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('client_documents')
    .update({ shared_with_client: shared })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id');
  // 42501: a removed client's document can only be unshared, never shared again.
  if (error?.code === '42501') return fail('document_share_client_removed', 'action:documents.setDocumentShared');
  if (error || data.length === 0) return fail('document_share_failed', 'action:documents.setDocumentShared');
  refresh();
  return { ok: true };
}

export async function deleteDocument(id: string): Promise<DocumentOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(id)) return fail('document_save_failed', 'action:documents.deleteDocument');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('client_documents').delete().eq('id', id).eq('workspace_id', workspaceId).select('storage_path');
  if (error) return fail('document_delete_failed', 'action:documents.deleteDocument');
  if (data.length === 0) return fail('document_already_gone', 'action:documents.deleteDocument');
  refresh();
  const removed = await supabase.storage.from(BUCKET).remove([data[0]!.storage_path]);
  return removed.error ? { ok: true, warning: 'The document is deleted, but its file could not be removed.' } : { ok: true };
}
