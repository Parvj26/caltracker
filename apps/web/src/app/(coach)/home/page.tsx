import type { Metadata } from 'next';
import { localToday } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { LiveRefresh } from '@/components/live-refresh';
import { renderTime } from '@/lib/live-refresh';
import { loadHomeData } from '@/lib/coach-home';
import { loadLiveLogs } from '@/lib/home-live';
import { createServerSupabase } from '@/lib/supabase/server';
import { HomeView } from './home-view';

export const metadata: Metadata = { title: 'Home' };

export default async function HomePage() {
  const { workspaceId, firstName, userId } = await requireCoach();
  const supabase = await createServerSupabase();
  const [data, live] = await Promise.all([loadHomeData(supabase, workspaceId, localToday('UTC')), loadLiveLogs(supabase, workspaceId)]);
  return (
    <>
      <LiveRefresh on={[{ table: 'workout_logs', filter: `workspace_id=eq.${workspaceId}` }, { table: 'awards', filter: `workspace_id=eq.${workspaceId}` }]} renderedAt={renderTime()} maxWaitMs={8000} />
      <HomeView coachFirstName={firstName} coachId={userId} data={data} live={live} />
    </>
  );
}
