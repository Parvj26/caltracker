import { cache } from 'react';
import { openFlagsNewestFirst, type ClientFlag } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadClientFlags } from './client-flag-rows';

/** One client's open flags, newest first (the chip on the logger, the builder's reminder). [] for a bad id. */
export const getOpenClientFlags = cache(async (clientId: string): Promise<ClientFlag[]> => {
  const { workspaceId } = await requireCoach();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return [];
  const supabase = await createServerSupabase();
  const flags = await loadClientFlags(supabase, workspaceId, [clientId], { openOnly: true });
  return openFlagsNewestFirst(flags.get(clientId) ?? []);
});
