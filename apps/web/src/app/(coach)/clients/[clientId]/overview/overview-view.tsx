'use client';

import type { Units } from '@caltracker/shared';
import { useLocalToday } from '@/lib/local-today';
import type { ClientOverview } from '@/lib/client-overview';
import { BodyMetricsCard, HighlightsCard, ProfileCard, TrainingCard, UpdatesCard } from './cards';
import { GoalCard, NotesCard } from './editors';
import { FlagsCard } from '@/components/flags/flags-card';
import { TodayCard } from './today-card';
import { InjuryChip } from '../injury-chip';
import styles from '../client-page.module.css';

/**
 * The client Overview: the injury chip and the Today card on top, then Training & Highlights, Body metrics & Updates, and the coach's side panel (Profile, Goal,
 * Limitations & injuries, Notes). Three columns from 1024 px (iPad landscape, laptop), two from 700 px, one below,
 * where Limitations & injuries moves up under Today so it is seen first (board AS9).
 */
export function OverviewView({ data, clientName, units, coachId, readOnly }: { data: ClientOverview; clientName: string; units: Units; coachId: string; readOnly: boolean }) {
  const today = useLocalToday();
  return (
    <>
    <InjuryChip flags={data.flags} />
    {readOnly ? null : <TodayCard data={data} today={today} coachId={coachId} />}
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
        <FlagsCard clientId={data.clientId} clientName={clientName} flags={data.flags} readOnly={readOnly} today={today} className={styles.flagsFirst} />
        <NotesCard clientId={data.clientId} notes={data.notes} readOnly={readOnly} />
      </aside>
    </div>
    </>
  );
}
