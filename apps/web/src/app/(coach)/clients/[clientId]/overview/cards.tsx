'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  OVERVIEW_PERIODS,
  OVERVIEW_PERIOD_LABELS,
  METRICS,
  ageLabel,
  bodyOverview,
  displayValue,
  formatMetric,
  formatMetricChange,
  formatShortDate,
  fromKg,
  latestUpdates,
  localDateOf,
  trainingSummary,
  type ClientUpdate,
  type IsoDate,
  type OverviewMetric,
  type OverviewPeriod,
  type TrackedCount,
  type Units,
} from '@caltracker/shared';
import { LocalDate } from '@/app/(coach)/workouts/local-date';
import { Card } from '@/components/ui';
import type { ClientOverview, OverviewEvent } from '@/lib/client-overview';
import { UPDATES_SHOWN } from '@/lib/client-overview';
import { LineChart } from '../progress/line-chart';
import { useNowMinute } from './use-now';
import styles from '../client-page.module.css';

const plainDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** A plain calendar date as "Sat 31 Oct". */
const dayText = (d: IsoDate) => plainDay.format(new Date(`${d}T00:00:00Z`));

function Tracked({ label, count }: { label: string; count: TrackedCount }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>
        {count.tracked}/{count.planned}
      </dd>
      <span className={styles.statNote}>tracked</span>
      {count.added > 0 ? <span className={styles.statNote}>+{count.added} added by the client</span> : null}
    </div>
  );
}

export function TrainingCard({ data, today }: { data: ClientOverview; today: IsoDate }) {
  const s = trainingSummary(data.workouts, data.addedFinishedAt.map((at) => localDateOf(at)), today);
  return (
    <Card className={styles.card} aria-labelledby="training-heading">
      <div className={styles.cardHead}>
        <h2 id="training-heading" className={styles.heading}>Training</h2>
        <Link href={`/clients/${data.clientId}/training`} className={styles.link}>Open calendar</Link>
      </div>
      <dl className={styles.stats}>
        <Tracked label="Last 7 days" count={s.last7} />
        <Tracked label="Last 30 days" count={s.last30} />
        <div className={styles.stat}>
          <dt>Next week</dt>
          <dd>{s.nextWeek > 0 ? s.nextWeek : 'Not assigned yet'}</dd>
          {s.nextWeek > 0 ? <span className={styles.statNote}>planned</span> : null}
        </div>
      </dl>
    </Card>
  );
}

export function HighlightsCard({ data, units }: { data: ClientOverview; units: Units }) {
  const h = data.highlights;
  const lifted = `${Math.round(fromKg(h.volumeKg, units)).toLocaleString('en-GB')} ${units}`;
  return (
    <Card className={styles.card} aria-labelledby="highlights-heading">
      <div className={styles.cardHead}>
        <h2 id="highlights-heading" className={styles.heading}>Highlights</h2>
        <span className={styles.caption}>All time</span>
      </div>
      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>Stickers</dt>
          <dd>{h.stickers}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Weight lifted</dt>
          <dd>{lifted}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Personal bests</dt>
          <dd>{h.personalBests}</dd>
        </div>
      </dl>
      <p className={styles.caption}>
        {h.workouts === 1 ? '1 workout' : `${h.workouts} workouts`} finished.{' '}
        <Link href={`/clients/${data.clientId}/training#bests-heading`} className="tap-inline">See bests and stickers</Link>
      </p>
    </Card>
  );
}

const SHORT_LABEL: Record<OverviewMetric, string> = { weight_kg: 'Weight', body_fat_pct: 'Body fat', smm_kg: 'Muscle mass' };

export function BodyMetricsCard({ data, units, today, readOnly }: { data: ClientOverview; units: Units; today: IsoDate; readOnly: boolean }) {
  const [period, setPeriod] = useState<OverviewPeriod>('4w');
  const [chosen, setChosen] = useState<OverviewMetric>('weight_kg');
  const metrics = bodyOverview(data.scans, period, today);
  const shown = metrics.find((m) => m.key === chosen)!;
  const periodId = 'body-period';
  return (
    <Card className={styles.card} aria-labelledby="body-heading">
      <div className={styles.cardHead}>
        <h2 id="body-heading" className={styles.heading}>Body metrics</h2>
        <div className={styles.periodRow}>
          <label htmlFor={periodId} className={styles.caption}>Period</label>
          <select id={periodId} className={styles.periodSelect} value={period} onChange={(e) => setPeriod(e.target.value as OverviewPeriod)}>
            {OVERVIEW_PERIODS.map((p) => (
              <option key={p} value={p}>{OVERVIEW_PERIOD_LABELS[p]}</option>
            ))}
          </select>
        </div>
      </div>
      {data.scans.length === 0 ? (
        <p className={styles.caption}>No InBody scans yet.</p>
      ) : (
        <>
          <ul className={styles.metrics} aria-label="Pick a measure to chart">
            {metrics.map((m) => (
              <li key={m.key}>
                <button
                  type="button"
                  className={styles.metric}
                  aria-pressed={m.key === chosen}
                  onClick={() => setChosen(m.key)}
                  aria-label={`${METRICS[m.key].label}: ${m.latest ? formatMetric(m.key, m.latest.value, units) : 'not measured'}${m.change !== null ? `, ${formatMetricChange(m.key, m.change, units)} over ${OVERVIEW_PERIOD_LABELS[period].toLowerCase()}` : ''}`}
                >
                  <span className={styles.metricLabel}>{SHORT_LABEL[m.key]}</span>
                  <span className={styles.metricValue}>{m.latest ? formatMetric(m.key, m.latest.value, units) : '–'}</span>
                  <span className={styles.metricChange}>{m.change !== null ? formatMetricChange(m.key, m.change, units) : ' '}</span>
                </button>
              </li>
            ))}
          </ul>
          {shown.points.length >= 2 ? (
            <div className={styles.chart}>
              <LineChart
                key={`${shown.key}-${period}`}
                title={`${METRICS[shown.key].label}, ${OVERVIEW_PERIOD_LABELS[period].toLowerCase()}`}
                points={shown.points.map((p) => ({
                  date: p.date,
                  label: formatShortDate(p.date, today),
                  value: displayValue(shown.key, p.value, units),
                  text: formatMetric(shown.key, p.value, units),
                }))}
                axisFormat={(v) => String(v)}
              />
            </div>
          ) : (
            <p className={styles.caption}>
              {shown.latest
                ? `Not enough ${METRICS[shown.key].label.toLowerCase()} entries in this period for a trend. Latest: ${formatShortDate(shown.latest.date, today)}.`
                : `No ${METRICS[shown.key].label.toLowerCase()} yet.`}
            </p>
          )}
        </>
      )}
      <p className={styles.caption}>
        <Link href={`/clients/${data.clientId}/body${readOnly ? '' : '?scan=1'}`} className="tap-inline">{readOnly ? 'See all scans' : 'Add scan'}</Link>
        {readOnly ? null : (
          <>
            {' · '}
            <Link href={`/clients/${data.clientId}/body`} className="tap-inline">All scans</Link>
          </>
        )}
      </p>
    </Card>
  );
}

function updateOf(e: OverviewEvent, firstName: string, clientId: string, units: Units): ClientUpdate {
  switch (e.kind) {
    case 'workout':
      return {
        id: e.id,
        kind: 'workout',
        at: e.at,
        text: `${e.byCoach ? 'You' : firstName} logged ${e.name}${e.plannedOn ? ` for ${dayText(e.plannedOn)}` : ''}`,
        href: `/clients/${clientId}/logs/${e.id.slice('log-'.length)}`,
      };
    case 'scan':
      return e.source === 'client'
        ? { id: e.id, kind: 'weight', at: e.at, text: `${firstName} logged their weight${e.weightKg !== null ? `: ${formatMetric('weight_kg', e.weightKg, units)}` : ''}` }
        : { id: e.id, kind: 'scan', at: e.at, text: `Body scan added for ${dayText(e.measuredOn)}`, href: `/clients/${clientId}/body` };
    case 'sticker':
      return { id: e.id, kind: 'sticker', at: e.at, text: `${firstName} earned the ${e.name} sticker` };
  }
}

export function UpdatesCard({ data, units }: { data: ClientOverview; units: Units }) {
  const now = useNowMinute();
  const updates = latestUpdates(
    data.events.map((e) => updateOf(e, data.firstName, data.clientId, units)),
    UPDATES_SHOWN,
  );
  return (
    <Card className={styles.card} aria-labelledby="updates-heading">
      <h2 id="updates-heading" className={styles.heading}>Updates</h2>
      {updates.length === 0 ? (
        <p className={styles.caption}>Nothing yet. Workouts, scans and stickers appear here.</p>
      ) : (
        <ul className={styles.feed}>
          {updates.map((u) => (
            <li key={u.id} className={styles.feedItem}>
              <span className={styles.feedText}>{u.href ? <Link href={u.href}>{u.text}</Link> : u.text}</span>
              <time className={styles.feedAge} dateTime={u.at} title={new Date(u.at).toISOString()}>
                {now ? ageLabel(u.at, now) : ''}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The client's local time ("4:30 pm, Dubai time"), or null when their zone isn't known. */
function localTime(now: Date, timeZone: string): string | null {
  try {
    const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
    const city = timeZone.split('/').at(-1)!.replace(/_/g, ' ');
    return `${time} · ${city} (${timeZone})`;
  } catch {
    return null;
  }
}

export function ProfileCard({ data }: { data: ClientOverview }) {
  const now = useNowMinute();
  const { email, timeZone, joinedAt } = data.profile;
  // Every profile starts on UTC until the phone sets the client's own zone, so UTC means "not set yet".
  const zone = timeZone && timeZone !== 'UTC' ? timeZone : null;
  const coachZone = now ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
  const time = now && zone ? localTime(now, zone) : null;
  return (
    <Card className={styles.card} aria-labelledby="profile-heading">
      <h2 id="profile-heading" className={styles.heading}>Profile</h2>
      <dl className={styles.facts}>
        <dt>Email</dt>
        <dd>{email ? <a href={`mailto:${email}`}>{email}</a> : 'Not known'}</dd>
        <dt>Local time</dt>
        <dd>
          {!zone ? 'Time zone not set yet (it updates when they open the app)' : time ?? ''}
          {zone && coachZone === zone ? <span className={styles.caption}> · same as yours</span> : null}
        </dd>
        {joinedAt ? (
          <>
            <dt>Joined</dt>
            <dd><LocalDate iso={joinedAt} /></dd>
          </>
        ) : null}
      </dl>
    </Card>
  );
}
