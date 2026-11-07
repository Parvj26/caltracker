'use client';

import type { Units } from '@caltracker/shared';
import { useLocalToday } from '@/lib/local-today';
import type { ClientOverview } from '@/lib/client-overview';
import { BodyMetricsCard, HighlightsCard, ProfileCard, TrainingCard, UpdatesCard } from './cards';
import { GoalCard, LimitationsCard, NotesCard } from './editors';
import styles from '../client-page.module.css';

/**
 * The client Overview: Training & Highlights, Body metrics & Updates, and the coach's side panel (Profile, Goal,
 * Limitations, Notes). Three columns from 1024 px (iPad landscape, laptop), two from 700 px, one below.
 */
export function OverviewView({ data, units, readOnly }: { data: ClientOverview; units: Units; readOnly: boolean }) {
  const today = useLocalToday();
  return (
    <div className={styles.grid}>
      <div className={styles.column}>
        <TrainingCard data={data} today={today} />
        <HighlightsCard data={data} units={units} />
      </div>
      <div className={styles.column}>
        <BodyMetricsCard data={data} units={units} today={today} readOnly={readOnly} />
        <UpdatesCard data={data} units={units} />
      </div>
      <aside className={`${styles.column} ${styles.side}`} aria-label="About this client">
        <ProfileCard data={data} />
        <GoalCard clientId={data.clientId} firstName={data.firstName} goal={data.goal} today={today} readOnly={readOnly} />
        <LimitationsCard clientId={data.clientId} body={data.limitations} readOnly={readOnly} />
        <NotesCard clientId={data.clientId} notes={data.notes} readOnly={readOnly} />
      </aside>
    </div>
  );
}
