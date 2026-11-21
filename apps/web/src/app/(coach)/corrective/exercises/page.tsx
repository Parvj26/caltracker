import type { Metadata } from 'next';
import { isMuscleId } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { LibraryTabs } from '../../library-tabs';
import { CorrectiveTabs } from '../corrective-tabs';
import { CorrectiveLibrary } from './library-view';
import { loadCorrectiveLibrary } from './load';

export const metadata: Metadata = { title: 'Corrective exercises' };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Library › Corrective › Exercises (board AS8). */
export default async function CorrectiveExercisesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workspaceId } = await requireCoach();
  const sp = await searchParams;
  const { items, builtins } = await loadCorrectiveLibrary(workspaceId);
  const show = one(sp.show);
  const muscle = one(sp.muscle);
  return (
    <CorrectiveLibrary
      workspaceId={workspaceId}
      items={items}
      builtins={builtins}
      initialShow={show === 'under' || show === 'over' || show === 'yours' ? show : 'all'}
      initialMuscle={isMuscleId(muscle) ? muscle : null}
      tabs={
        <>
          <LibraryTabs current="/corrective" />
          <CorrectiveTabs current="/corrective/exercises" />
        </>
      }
    />
  );
}
