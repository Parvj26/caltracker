import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { localToday } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { getClient } from '@/lib/page-data';
import { clientPageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { FoodView } from '../../food-tab/food-view';
import { loadFoodWeek } from '../../food-tab/load';
import { weekFromParam } from '../../food-tab/week';

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
  const { workspaceId } = await requireCoach();
  const [{ clientId }, query] = await Promise.all([params, searchParams]);
  const client = await getClient(clientId);
  if (!client) notFound();
  // UTC on the server; a day of slack either way is fine for picking the week (the page labels days in the browser).
  const monday = weekFromParam(query.week, localToday('UTC'));
  const week = await loadFoodWeek(await createServerSupabase(), workspaceId, client.id, monday);
  return (
    <FoodView
      key={monday}
      clientId={client.id}
      firstName={client.firstName}
      monday={monday}
      targets={week.targets}
      meals={week.meals}
      readOnly={client.removedAt !== null}
    />
  );
}
