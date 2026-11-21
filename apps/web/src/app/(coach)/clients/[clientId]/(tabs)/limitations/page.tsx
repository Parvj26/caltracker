import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cycleView, observedFindings } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { getClient } from '@/lib/page-data';
import { loadClientFlags } from '@/lib/client-flag-rows';
import { clientPageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadAssessment, loadCycles, loadInitialKeys, loadLibrary, loadTemplates } from '../../assessments/load';
import { LimitationsView } from '../../assessments/limitations-view';

export async function generateMetadata({ params }: { params: Promise<{ clientId: string }> }): Promise<Metadata> {
  return clientPageTitle((await params).clientId, 'Limitations & injuries');
}

/**
 * "Limitations & injuries" (board AS1): the assessment cycle card (Initial → Retest 1 → optional Retest 2, + New
 * cycle), the newest finished assessment's findings, and the client's flags (the same card as on the Overview).
 */
export default async function ClientLimitationsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { workspaceId } = await requireCoach();
  const { clientId } = await params;
  const client = await getClient(clientId);
  if (!client) notFound();
  const supabase = await createServerSupabase();
  const [cycles, library, templates, flags] = await Promise.all([
    loadCycles(supabase, workspaceId, client.id),
    loadLibrary(supabase),
    loadTemplates(supabase, workspaceId),
    loadClientFlags(supabase, workspaceId, [client.id]),
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
      templates={templates}
      initialKeys={initialKeys}
      latest={latest ? { id: latest.id, slot: latest.slot, assessedOn: latest.assessedOn } : null}
      findings={findings}
      flags={flags.get(client.id) ?? []}
      readOnly={client.removedAt !== null}
    />
  );
}
