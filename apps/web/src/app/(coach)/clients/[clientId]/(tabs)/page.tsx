import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { localToday } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { loadClientOverview } from '@/lib/client-overview';
import { getClient } from '@/lib/page-data';
import { clientPageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { OverviewView } from '../overview/overview-view';

export async function generateMetadata({ params }: { params: Promise<{ clientId: string }> }): Promise<Metadata> {
  return clientPageTitle((await params).clientId);
}

type Query = Record<string, string | string[] | undefined>;

/**
 * Links made before the tabs still land where they meant to: ?scan=1 on Body; ?assign, ?month and the calendar's
 * own ?view= and ?from= (the 1-, 2- and 4-week views) on Training, with all of them kept.
 */
function oldLinkTarget(clientId: string, query: Query): string | null {
  const keep = (keys: string[]) => {
    const p = new URLSearchParams();
    for (const k of keys) {
      const v = query[k];
      if (typeof v === 'string') p.set(k, v);
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  if (query.scan !== undefined) return `/clients/${clientId}/body${keep(['scan'])}`;
  const training = ['month', 'view', 'from'];
  if (training.some((k) => query[k] !== undefined)) return `/clients/${clientId}/training${keep(training)}`;
  return null;
}

export default async function ClientOverviewPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<Query> }) {
  const { workspaceId, units } = await requireCoach();
  const [{ clientId }, query] = await Promise.all([params, searchParams]);
  const client = await getClient(clientId);
  if (!client) notFound();
  const target = oldLinkTarget(client.id, query);
  if (target) redirect(target);

  const data = await loadClientOverview(await createServerSupabase(), workspaceId, client, localToday('UTC'));
  return <OverviewView data={data} units={units} readOnly={client.removedAt !== null} />;
}
