import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FoodScreen } from '@/components/view-as/food';
import { ProgressScreen } from '@/components/view-as/progress';
import { TodayScreen } from '@/components/view-as/today';
import { ViewAsFrame } from '@/components/view-as/view-as-frame';
import styles from '@/components/view-as/view-as.module.css';
import { WorkoutsScreen } from '@/components/view-as/workouts';
import { requireAdmin } from '@/lib/admin';
import { UUID } from '@/lib/actions-shared';
import { fromJson, nameOr, type ViewAsSnapshot } from '@/lib/admin-data';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'View as' };

/** Read-only "View as": one audited snapshot (admin_view_as_snapshot), drawn as simple versions of the client's screens. */
export default async function ViewAsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin('support');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('admin_view_as_snapshot', { p_user_id: id });
  if (error) {
    if (error.code === 'P0002') notFound();
    throw new Error(`Could not load View as: ${error.message}`);
  }
  const s = fromJson<ViewAsSnapshot>(data);
  const name = nameOr(s.profile?.name);
  const units = s.profile?.units === 'lb' ? 'lb' : 'kg';

  return (
    <>
      <div className={styles.banner} role="note">
        <span>Viewing as {name} · read-only · logged</span>
        <Link href={`/clients/${id}`} className={styles.exit}>Exit</Link>
      </div>
      <ViewAsFrame
        header={
          <div className={styles.phoneTop}>
            <span className={styles.phoneName}>{name}</span>
            <span className={styles.phoneCoach}>{s.coach ? `Coach: ${nameOr(s.coach.name)}` : 'No coach'}</span>
          </div>
        }
        screens={{
          Today: <TodayScreen s={s} />,
          Workouts: <WorkoutsScreen s={s} units={units} />,
          Food: <FoodScreen s={s} />,
          Progress: <ProgressScreen s={s} units={units} />,
        }}
      />
    </>
  );
}
