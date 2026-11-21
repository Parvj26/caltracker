import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cycleView, observedFindings } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { getClient, getClientLimitations } from '@/lib/page-data';
import { clientPageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadAssessment, loadCycles, loadInitialKeys, loadLibrary } from '../../assessments/load';
import { LimitationsView } from '../../assessments/limitations-view';

export async function generateMetadata({ params }: { params: Promise<{ clientId: string }> }): Promise<Metadata> {
  return clientPageTitle((await params).clientId, 'Limitations & injuries');
}

/**
 * "Limitations & injuries" (board AS1): the assessment cycle card (Initial → Retest 1 → optional Retest 2, + New
 * cycle), the newest finished assessment's findings, and the coach's injuries note as it is on the Overview (flags
 * replace it in a later step).
 */
export default async function ClientLimitationsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { workspaceId } = await requireCoach();
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client) notFound();
  const supabase = await createServerSupabase();
  const [cycles, library, limitations] = await Promise.all([
    loadCycles(supabase, workspaceId, client.id),
    loadLibrary(supabase),
    getClientLimitations(client.id),
  ]);
  const view = cycleView(cycles);
  const [latest, initialKeys] = await Promise.all([
    view.latestDone ? loadAssessment(supabase, workspaceId, client.id, view.latestDone.id) : null,
    view.current ? loadInitialKeys(supabase, workspaceId, view.current.id) : [],
  ]);
  const findings = latest ? observedFindings(latest.tests.map((t) => ({ definition: t.definition, status: t.entry.status, results: t.entry.results }))) : [];
  return (
    <LimitationsView
      client={{ id: client.id, name: client.name, firstName: client.firstName }}
      cycles={cycles}
      library={library}
      initialKeys={initialKeys}
      latest={latest ? { id: latest.id, slot: latest.slot, assessedOn: latest.assessedOn } : null}
      findings={findings}
      limitations={limitations}
      readOnly={client.removedAt !== null}
    />
  );
}
