import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { METRIC_CATALOGUE, isMetricKey } from '@caltracker/shared';
import { ParentBackLink } from '@/components/back-link';
import { requireCoach } from '@/lib/auth';
import { metricsTabHref } from '@/lib/metrics-paths';
import { getClient } from '@/lib/page-data';
import { pageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadProgress } from '../../../progress/load';
import { loadMetricEntries } from '../../load';
import { MetricDetail } from './metric-detail';

export async function generateMetadata({ params }: { params: Promise<{ clientId: string; metricKey: string }> }): Promise<Metadata> {
  const { clientId, metricKey } = await params;
  const client = await getClient(clientId);
  if (!client || !isMetricKey(metricKey)) return pageTitle('Not found');
  return pageTitle(METRIC_CATALOGUE[metricKey].longLabel, client.name, 'Clients');
}

/**
 * One body metric for a client (Metrics › Body): the latest value, a chart over 3 months / 1 year / all (?range=), and
 * every entry, newest first. The coach's own entries can be edited or deleted here; scan values open their printout.
 */
export default async function BodyMetricPage({ params }: { params: Promise<{ clientId: string; metricKey: string }> }) {
  const { workspaceId, units } = await requireCoach();
  const { clientId, metricKey } = await params;
  if (!isMetricKey(metricKey)) notFound();
  const client = await getClient(clientId);
  if (!client) notFound();
  const supabase = await createServerSupabase();
  const [entries, progress] = await Promise.all([
    loadMetricEntries(supabase, workspaceId, client.id, metricKey),
    // Scan printouts (signed links), for "View printout" on scan values.
    METRIC_CATALOGUE[metricKey].sources.includes('inbody_scan') ? loadProgress(supabase, workspaceId, client.id) : null,
  ]);
  const printouts = Object.fromEntries((progress?.scans ?? []).flatMap((s) => (s.printoutUrl ? [[s.id, s.printoutUrl]] : [])));
  return (
    <MetricDetail
        back={<ParentBackLink href={metricsTabHref(client.id)} label={`${client.firstName || client.name}’s metrics`} />}
        client={{ id: client.id, firstName: client.firstName }}
        metricKey={metricKey}
        units={units}
        entries={entries}
        printouts={printouts}
        readOnly={client.removedAt !== null}
    />
  );
}
