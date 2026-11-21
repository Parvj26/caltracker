import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { checkpointLabels, loadMarks } from '@/lib/assessment-findings';
import { getClient } from '@/lib/page-data';
import { pageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { FindingsView } from '../../findings-view';
import { loadAssessment } from '../../load';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(clientId: string, assessmentId: string) {
  const { workspaceId } = await requireCoach();
  const client = await getClient(clientId);
  if (!client || !UUID.test(assessmentId)) return null;
  const supabase = await createServerSupabase();
  const assessment = await loadAssessment(supabase, workspaceId, client.id, assessmentId);
  if (!assessment) return null;
  const { marks, checks } = await loadMarks(supabase, workspaceId, assessment.id);
  return { client, assessment, marks, checks };
}

export async function generateMetadata({ params }: { params: Promise<{ clientId: string; assessmentId: string }> }): Promise<Metadata> {
  const { clientId, assessmentId } = await params;
  const loaded = await load(clientId, assessmentId);
  return loaded ? pageTitle('Findings', loaded.client.name, 'Clients') : pageTitle(null);
}

/**
 * Findings (AS4): the review after the last test. Editable while the assessment is a draft of a current client;
 * otherwise read-only (a finished assessment's findings are locked with it; a removed client's are history).
 */
export default async function FindingsPage({ params }: { params: Promise<{ clientId: string; assessmentId: string }> }) {
  const { clientId, assessmentId } = await params;
  const loaded = await load(clientId, assessmentId);
  if (!loaded) notFound();
  const { client, assessment, marks, checks } = loaded;
  const editable = assessment.status === 'draft' && client.removedAt === null;
  return (
    <FindingsView
      key={assessment.id}
      client={{ id: client.id, name: client.name }}
      assessment={assessment}
      initialMarks={marks}
      initialChecks={checks}
      labels={checkpointLabels(assessment.tests.map((t) => t.definition))}
      editable={editable}
    />
  );
}
