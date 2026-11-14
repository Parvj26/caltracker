import type { Metadata } from 'next';
import { LIBRARY_TRACKING_TYPES } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { ButtonLink } from '@/components/ui';
import { ExerciseBrowser } from './exercise-browser';
import styles from './exercises.module.css';

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
      <header className={styles.titleRow}>
        <h1 className={styles.title}>Exercises</h1>
        {/* A phone shows a small lime "+ New"; the name stays "New custom exercise" for screen readers. */}
        <ButtonLink href="/exercises/new" className={styles.newButton} aria-label="New custom exercise">
          <span className={styles.wideOnly}>New custom exercise</span>
          <span className={styles.phoneOnly} aria-hidden="true">
            + New
          </span>
        </ButtonLink>
      </header>
      <ExerciseBrowser
        workspaceId={workspaceId}
        initialQuery={one(sp.q).trim().slice(0, 100)}
        initialSource={source === 'builtin' || source === 'custom' ? source : ''}
        initialTracking={(LIBRARY_TRACKING_TYPES as readonly string[]).includes(tracking) ? tracking : ''}
      />
    </div>
  );
}
