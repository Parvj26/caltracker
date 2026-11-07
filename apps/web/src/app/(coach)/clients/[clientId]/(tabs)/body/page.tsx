import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { getClient } from '@/lib/page-data';
import { clientPageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadProgress } from '../../progress/load';
import { ProgressSection } from '../../progress/progress-section';

export async function generateMetadata({ params }: { params: Promise<{ clientId: string }> }): Promise<Metadata> {
  return clientPageTitle((await params).clientId, 'Body');
}

/** Body: InBody scans and the client's weigh-ins, as charts and a history (the body-scans section). */
export default async function ClientBodyPage({
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
  const progress = await loadProgress(await createServerSupabase(), workspaceId, client.id);
  return (
    <ProgressSection
      workspaceId={workspaceId}
      client={{ id: client.id, name: client.name }}
      units={units}
      data={progress}
      readOnly={client.removedAt !== null}
      openScan={query.scan === '1'}
    />
  );
}
