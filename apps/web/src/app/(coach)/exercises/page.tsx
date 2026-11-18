import type { Metadata } from 'next';
import { LIBRARY_TRACKING_TYPES } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { CreateLink, PageHeader } from '@/components/ui';
import { ExerciseBrowser } from './exercise-browser';
import styles from './exercises.module.css';
import { LibraryTabs } from '../library-tabs';

export const metadata: Metadata = { title: 'Exercises' };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function ExercisesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workspaceId } = await requireCoach();
  const sp = await searchParams;
  const tracking = one(sp.tracking);
  const source = one(sp.source);

  return (
    <div className={styles.page}>
      <PageHeader title="Exercises" action={<CreateLink href="/exercises/new" thing="exercise" data-ph-capture-attribute-label="exercise_new" />} />
      <LibraryTabs current="/exercises" />
      <ExerciseBrowser
        workspaceId={workspaceId}
        initialQuery={one(sp.q).trim().slice(0, 100)}
        initialSource={source === 'builtin' || source === 'custom' ? source : ''}
        initialTracking={(LIBRARY_TRACKING_TYPES as readonly string[]).includes(tracking) ? tracking : ''}
      />
    </div>
  );
}
