import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { checkpointLabels, loadCorrectiveChoices, loadMarks, loadPicks } from '@/lib/assessment-findings';
import { getClient } from '@/lib/page-data';
import { pageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadExercisePrefs } from '@/lib/workouts';
import { ExercisesView } from '../../exercises-view';
import { loadAssessment } from '../../load';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(clientId: string, assessmentId: string) {
  const { workspaceId, units } = await requireCoach();
  const client = await getClient(clientId);
  if (!client || !UUID.test(assessmentId)) return null;
  const supabase = await createServerSupabase();
  const assessment = await loadAssessment(supabase, workspaceId, client.id, assessmentId);
  if (!assessment) return null;
  const [{ marks }, picks, choices, prefs] = await Promise.all([
    loadMarks(supabase, workspaceId, assessment.id),
    loadPicks(supabase, workspaceId, assessment.id),
    loadCorrectiveChoices(supabase, workspaceId),
    loadExercisePrefs(supabase, workspaceId),
  ]);
  return { client, assessment, marks, picks, choices, prefs, units, workspaceId };
}

export async function generateMetadata({ params }: { params: Promise<{ clientId: string; assessmentId: string }> }): Promise<Metadata> {
  const { clientId, assessmentId } = await params;
  const loaded = await load(clientId, assessmentId);
  return loaded ? pageTitle('Exercises', loaded.client.name, 'Clients') : pageTitle(null);
}

/**
 * Exercises per confirmed muscle (AS5) and the suggested workout (AS5b). Picks can change while the client is current
 * (also after finishing: they remake the workout); a removed client's are read-only.
 */
export default async function ExercisesPage({ params }: { params: Promise<{ clientId: string; assessmentId: string }> }) {
  const { clientId, assessmentId } = await params;
  const loaded = await load(clientId, assessmentId);
  if (!loaded) notFound();
  const { client, assessment, marks, picks, choices, prefs, units, workspaceId } = loaded;
  return (
    <ExercisesView
      key={assessment.id}
      client={{ id: client.id, name: client.name, firstName: client.firstName }}
      assessment={assessment}
      marks={marks}
      savedPicks={picks.saved ? picks.picks : null}
      coach={choices.coach}
      builtins={choices.builtins}
      labels={checkpointLabels(assessment.tests.map((t) => t.definition))}
      current={client.removedAt === null}
      units={units}
      workspaceId={workspaceId}
      prefs={prefs}
    />
  );
}
