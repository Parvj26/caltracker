import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { SLOT_LABELS } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { getClient } from '@/lib/page-data';
import { pageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadAssessment } from '../load';
import { RunView } from '../run-view';
import { SummaryView } from '../summary-view';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(clientId: string, assessmentId: string) {
  const { workspaceId } = await requireCoach();
  const client = await getClient(clientId);
  if (!client || !UUID.test(assessmentId)) return null;
  const assessment = await loadAssessment(await createServerSupabase(), workspaceId, client.id, assessmentId);
  return assessment ? { client, assessment } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ clientId: string; assessmentId: string }> }): Promise<Metadata> {
  const { clientId, assessmentId } = await params;
  const loaded = await load(clientId, assessmentId);
  return loaded ? pageTitle(SLOT_LABELS[loaded.assessment.slot], loaded.client.name, 'Clients') : pageTitle(null);
}

/**
 * One assessment: a draft opens where the coach left off (AS3); a finished one shows its summary (AS6, step 1). A
 * removed client's draft can't be continued, so it goes back to the tab.
 */
export default async function AssessmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string; assessmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientId, assessmentId }, query] = await Promise.all([params, searchParams]);
  const loaded = await load(clientId, assessmentId);
  if (!loaded) notFound();
  const { client, assessment } = loaded;
  const who = { id: client.id, name: client.name };
  if (assessment.status === 'done') return <SummaryView client={who} assessment={assessment} />;
  if (client.removedAt !== null) redirect(`/clients/${client.id}/limitations`);
  // ?test=N reopens a given test (kept in the address as the coach moves on, so a reload stays put).
  const test = typeof query.test === 'string' && /^\d{1,2}$/.test(query.test) ? Number(query.test) : null;
  return <RunView client={who} assessment={assessment} testFromUrl={test} />;
}
