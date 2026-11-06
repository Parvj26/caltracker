import type { Metadata } from 'next';
import { localToday } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { loadHomeData } from '@/lib/coach-home';
import { createServerSupabase } from '@/lib/supabase/server';
import { HomeView } from './home-view';

export const metadata: Metadata = { title: 'Home' };

export default async function HomePage() {
  const { workspaceId, firstName, userId } = await requireCoach();
  const supabase = await createServerSupabase();
  const data = await loadHomeData(supabase, workspaceId, localToday('UTC'));
  return <HomeView coachFirstName={firstName} coachId={userId} data={data} />;
}
