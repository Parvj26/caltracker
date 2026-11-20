import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { getClient } from '@/lib/page-data';
import { clientPageTitle } from '@/lib/page-titles';
import { localToday, strengthExerciseRows } from '@caltracker/shared';
import { StrengthSection } from '@/components/strength/strength-section';
import { loadClientStrengthIn } from '@/lib/client-strength';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadMetricEntries } from '../../metrics/load';
import { MetricsView } from '../../metrics/metrics-view';
import { loadProgress } from '../../progress/load';

export async function generateMetadata({ params }: { params: Promise<{ clientId: string }> }): Promise<Metadata> {
  return clientPageTitle((await params).clientId, 'Metrics');
}

/**
 * Metrics: Body (six metric cards: latest value, trend and change over 3 months / 1 year / all, + Log metric), then
 * Strength (the heaviest weight per exercise, each opening its progress page), then the InBody scan history (edit,
 * delete, printouts and custom measures).
 */
export default async function ClientMetricsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ scan?: string | string[] }>;
}) {
  const { workspaceId, units } = await requireCoach();
  const [{ clientId }, query] = await Promise.all([params, searchParams]);
  const client = await getClient(clientId);
  if (!client) notFound();
  const supabase = await createServerSupabase();
  const [entries, progress, strength] = await Promise.all([
    loadMetricEntries(supabase, workspaceId, client.id),
    loadProgress(supabase, workspaceId, client.id),
    loadClientStrengthIn(supabase, workspaceId, client.id),
  ]);
  const strengthRows = strengthExerciseRows(strength.exercises, units, localToday(strength.timeZone));
  return (
    <MetricsView
      workspaceId={workspaceId}
      client={{ id: client.id, name: client.name, firstName: client.firstName }}
      units={units}
      entries={entries}
      progress={progress}
      readOnly={client.removedAt !== null}
      openScan={query.scan === '1'}
      strength={<StrengthSection clientId={client.id} rows={strengthRows} />}
    />
  );
}
