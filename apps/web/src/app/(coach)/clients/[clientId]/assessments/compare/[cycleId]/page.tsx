import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { getClient } from '@/lib/page-data';
import { pageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { CompareView, type StartRetest2 } from '../../compare-view';
import { loadCycleForCompare, loadInitialKeys, loadLibrary, loadTemplates } from '../../load';
import { CompareBodyMaps, CompareMuscles } from '../../step2-slots';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(clientId: string, cycleId: string) {
  const { workspaceId } = await requireCoach();
  const client = await getClient(clientId);
  if (!client || !UUID.test(cycleId)) return null;
  const supabase = await createServerSupabase();
  const cycle = await loadCycleForCompare(supabase, workspaceId, client.id, cycleId);
  return cycle ? { client, cycle, supabase, workspaceId } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ clientId: string; cycleId: string }> }): Promise<Metadata> {
  const { clientId, cycleId } = await params;
  const loaded = await load(clientId, cycleId);
  return loaded ? pageTitle(`Compare cycle ${loaded.cycle.number}`, loaded.client.name, 'Clients') : pageTitle(null);
}

/**
 * Compare (AS7): Initial, Retest 1 and Retest 2 of one cycle. Needs two finished assessments; before that it goes back
 * to the tab. Retest 2's empty column can start it (newest cycle, current client, nothing half-done).
 */
export default async function ComparePage({ params }: { params: Promise<{ clientId: string; cycleId: string }> }) {
  const { clientId, cycleId } = await params;
  const loaded = await load(clientId, cycleId);
  if (!loaded) notFound();
  const { client, cycle, supabase, workspaceId } = loaded;
  if (cycle.done.length < 2) redirect(`/clients/${client.id}/limitations`);

  const readOnly = client.removedAt !== null;
  const retest2Done = cycle.done.some((a) => a.slot === 'retest_2');
  const anyDraft = cycle.summaries.some((a) => a.status === 'draft');
  let canStart: StartRetest2 | null = null;
  if (!retest2Done && !anyDraft && cycle.isNewest && !readOnly) {
    const [library, templates, initialKeys] = await Promise.all([loadLibrary(supabase), loadTemplates(supabase, workspaceId), loadInitialKeys(supabase, workspaceId, cycle.id)]);
    canStart = { library, templates, initialKeys };
  }
  const slot = { clientId: client.id, columns: cycle.done };
  return (
    <CompareView
      client={{ id: client.id, name: client.name }}
      cycleNumber={cycle.number}
      done={cycle.done}
      retest2={retest2Done ? null : { canStart }}
      readOnly={readOnly}
      slots={{ bodyMaps: <CompareBodyMaps {...slot} />, muscles: <CompareMuscles {...slot} /> }}
    />
  );
}
