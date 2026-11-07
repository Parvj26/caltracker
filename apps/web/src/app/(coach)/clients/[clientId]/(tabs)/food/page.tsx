import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { localToday } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { getClient } from '@/lib/page-data';
import { clientPageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { FoodView } from '../../food-tab/food-view';
import { loadFoodWeek } from '../../food-tab/load';
import { TIME_ZONE_COOKIE, validTimeZone, weekFromParam } from '../../food-tab/week';

/** The cookie value as the browser wrote it (encoded), or as given when it is not encoded. */
function safeDecode(v: string | undefined): string | undefined {
  try {
    return v === undefined ? v : decodeURIComponent(v);
  } catch {
    return v;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ clientId: string }> }): Promise<Metadata> {
  return clientPageTitle((await params).clientId, 'Food');
}

/** Food: the client's daily targets (editable), one week of daily totals against them, and each day's meals with photos. */
export default async function ClientFoodPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ week?: string | string[] }>;
}) {
  const { workspaceId, userId } = await requireCoach();
  const [{ clientId }, query, jar] = await Promise.all([params, searchParams, cookies()]);
  const client = await getClient(clientId);
  if (!client) notFound();
  const supabase = await createServerSupabase();
  // "This week" is the coach's own: the zone their browser saved, else the one on their profile, else UTC.
  const fromBrowser = validTimeZone(safeDecode(jar.get(TIME_ZONE_COOKIE)?.value));
  let zone = fromBrowser;
  if (!zone) {
    const { data } = await supabase.from('profiles').select('time_zone').eq('id', userId).maybeSingle();
    zone = validTimeZone(data?.time_zone) ?? 'UTC';
  }
  const monday = weekFromParam(query.week, localToday(zone));
  const week = await loadFoodWeek(supabase, workspaceId, client.id, monday);
  return (
    <FoodView
      key={monday}
      clientId={client.id}
      firstName={client.firstName}
      monday={monday}
      targets={week.targets}
      meals={week.meals}
      readOnly={client.removedAt !== null}
      serverZone={fromBrowser}
      pickedWeek={typeof query.week === 'string'}
    />
  );
}
