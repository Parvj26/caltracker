'use server';

import { revalidatePath } from 'next/cache';
import type { MacroKey } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { parseTargetsForm } from './week';

// The client's daily food targets. The workspace comes from requireCoach(), never from the browser; the database
// function runs as the coach, so RLS decides: only the coach of the workspace, only for a current client.

export type TargetsOutcome = { ok: true } | { ok: false; error: string; fieldErrors?: Partial<Record<MacroKey, string>> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC = "Couldn't save the targets. Please try again.";

export async function saveTargets(clientId: string, input: Partial<Record<MacroKey, string>>): Promise<TargetsOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(clientId) || typeof input !== 'object' || input === null) return { ok: false, error: GENERIC };
  const parsed = parseTargetsForm(input);
  if (!parsed.ok) return { ok: false, error: 'Check the highlighted targets.', fieldErrors: parsed.errors };
  const supabase = await createServerSupabase();
  const { calories, protein, carbs, fat } = parsed.value;
  // A blank target is null, which the function stores as "no target"; the generated argument types can't say
  // nullable for a plain SQL function, hence the casts.
  const { error } = await supabase.rpc('set_nutrition_targets', {
    p_workspace_id: workspaceId,
    p_client_id: clientId,
    p_calories: calories as number,
    p_protein_g: protein as number,
    p_carbs_g: carbs as number,
    p_fat_g: fat as number,
  });
  if (error) return { ok: false, error: error.code === '42501' ? "This client was removed, so their targets can't change." : GENERIC };
  revalidatePath('/clients/[clientId]/food', 'page');
  return { ok: true };
}
