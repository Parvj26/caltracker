import { localToday } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { loadHomeData } from '@/lib/coach-home';
import { createServerSupabase } from '@/lib/supabase/server';
import { HomeView } from './home-view';

export default async function HomePage() {
  const { workspaceId, firstName } = await requireCoach();
  const supabase = await createServerSupabase();
  const data = await loadHomeData(supabase, workspaceId, localToday('UTC'));
  return <HomeView coachFirstName={firstName} data={data} />;
}
