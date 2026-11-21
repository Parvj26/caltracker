'use server';

import { revalidatePath } from 'next/cache';
import { checkTemplateInput } from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// Assessment templates (AS11): save a named set of tests, rename or reorder it, delete it. The workspace id comes from
// requireCoach(), never the browser; RLS (20261121001000_assessment_templates.sql) checks again that the caller is a
// coach of that workspace, and the table's trigger that every test is in the library.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

const refresh = () => {
  revalidatePath('/corrective/templates');
  // The start pop-up on every client's Limitations & injuries tab lists them.
  revalidatePath('/clients/[clientId]', 'layout');
};

function failFor(error: { code?: string }, where: string): ActionFailure {
  if (error.code === '23505') return fail('template_name_taken', where);
  if (error.code === '22023' || error.code === '23514') return fail('template_invalid', where);
  return fail('template_save_failed', where);
}

export async function createTemplate(input: unknown): Promise<{ ok: true; id: string } | ActionFailure> {
  const { workspaceId } = await requireCoach();
  const checked = checkTemplateInput(input);
  if (!checked) return fail('template_invalid', 'action:templates.create');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('assessment_templates')
    .insert({ workspace_id: workspaceId, name: checked.name, test_keys: checked.testKeys })
    .select('id')
    .single();
  if (error) return failFor(error, 'action:templates.create');
  refresh();
  return { ok: true, id: data.id };
}

export async function updateTemplate(id: string, input: unknown): Promise<{ ok: true } | ActionFailure> {
  const { workspaceId } = await requireCoach();
  const checked = checkTemplateInput(input);
  if (!isUuid(id) || !checked) return fail('template_invalid', 'action:templates.update');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('assessment_templates')
    .update({ name: checked.name, test_keys: checked.testKeys })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id');
  if (error) return failFor(error, 'action:templates.update');
  if (data.length === 0) return fail('template_not_found', 'action:templates.update');
  refresh();
  return { ok: true };
}

export async function deleteTemplate(id: string): Promise<{ ok: true } | ActionFailure> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(id)) return fail('template_not_found', 'action:templates.delete');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('assessment_templates').delete().eq('id', id).eq('workspace_id', workspaceId).select('id');
  if (error) return fail('template_delete_failed', 'action:templates.delete');
  if (data.length === 0) return fail('template_not_found', 'action:templates.delete');
  refresh();
  return { ok: true };
}
