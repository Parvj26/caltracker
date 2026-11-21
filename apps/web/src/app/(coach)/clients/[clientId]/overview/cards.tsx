'use client';

import Link from 'next/link';
import { metricsTabHref } from '@/lib/metrics-paths';
import layout from '@/components/ui/layout.module.css';
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
  formatPlainDay,
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
import { ButtonLink, Card } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import type { ClientOverview, OverviewEvent } from '@/lib/client-overview';
import { UPDATES_SHOWN } from '@/lib/client-overview';
import { LineChart } from '../progress/line-chart';
import { useNowMinute } from './use-now';
import { useUrlChoice } from '@/lib/url-state';
import styles from '../client-page.module.css';

/** A plain calendar date as "Sat 31 Oct" (same text on the server and in Safari). */
const dayText = (d: IsoDate) => formatPlainDay(d);

function Tracked({ label, count }: { label: string; count: TrackedCount }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      {/* The notes sit inside the <dd>, so the list holds only dt/dd pairs. */}
      <dd>
        {count.tracked}/{count.planned}
        <span className={styles.statNote}>tracked</span>
        {count.added > 0 ? <span className={styles.statNote}>+{count.added} added by the client</span> : null}
      </dd>
    </div>
  );
}

/**
 * A card's title row as one link (title, an optional note such as "All time", and a chevron), so the whole row opens
 * the page behind the card. The card holds no second link to the same place.
 */
function CardHeadLink({ href, id, title, note }: { href: string; id: string; title: string; note?: string }) {
  return (
    <Link href={href} className={styles.cardHeadLink}>
      <h2 id={id} className={styles.heading}>{title}</h2>
      <span className={styles.cardHeadEnd}>
        {note ? <span className={styles.caption}>{note}</span> : null}
        <ChevronIcon direction="right" />
      </span>
    </Link>
  );
}

export function TrainingCard({ data, today }: { data: ClientOverview; today: IsoDate }) {
  const s = trainingSummary(data.workouts, data.addedFinishedAt.map((at) => localDateOf(at)), today);
  // Nothing ever planned or added: one line instead of three empty boxes (the Today card above has "+ Add workout").
  const none = data.workouts.length === 0 && data.addedFinishedAt.length === 0;
  return (
    <Card className={styles.card} aria-labelledby="training-heading">
      <CardHeadLink href={`/clients/${data.clientId}/training`} id="training-heading" title="Training" />
      {none ? (
        <p className={styles.caption}>No workouts yet.</p>
      ) : (
      <dl className={styles.stats}>
        <Tracked label="Last 7 days" count={s.last7} />
        <Tracked label="Last 30 days" count={s.last30} />
        <div className={styles.stat}>
          <dt>Next week</dt>
          <dd>
            {s.nextWeek > 0 ? s.nextWeek : <span className={styles.statWords}>Not assigned yet</span>}
            {s.nextWeek > 0 ? <span className={styles.statNote}>planned</span> : null}
          </dd>
        </div>
      </dl>
      )}
    </Card>
  );
}

export function HighlightsCard({ data, units }: { data: ClientOverview; units: Units }) {
  // The title row opens the client's bests and stickers (on the Training tab).
  const h = data.highlights;
  const lifted = `${Math.round(fromKg(h.volumeKg, units)).toLocaleString('en-GB')} ${units}`;
  return (
    <Card className={styles.card} aria-labelledby="highlights-heading">
      <CardHeadLink href={`/clients/${data.clientId}/training#bests-heading`} id="highlights-heading" title="Highlights" note="All time" />
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
      <p className={styles.caption}>{h.workouts === 1 ? '1 workout' : `${h.workouts} workouts`} finished.</p>
    </Card>
  );
}

const SHORT_LABEL: Record<OverviewMetric, string> = { weight_kg: 'Weight', body_fat_pct: 'Body fat', smm_kg: 'Muscle mass' };

export function BodyMetricsCard({ data, units, today, readOnly }: { data: ClientOverview; units: Units; today: IsoDate; readOnly: boolean }) {
  // Kept in the address (?period=), so a reload or Back to Overview keeps it.
  const [period, setPeriod] = useUrlChoice<OverviewPeriod>('period', OVERVIEW_PERIODS, '4w');
  const [chosen, setChosen] = useState<OverviewMetric>('weight_kg');
  const metrics = bodyOverview(data.scans, period, today);
  const shown = metrics.find((m) => m.key === chosen)!;
  const periodId = 'body-period';
  // The grey "Add"-style button (as on Clients' "Assign"); not for a past client.
  const logMetric = readOnly ? null : (
    <ButtonLink href={`${metricsTabHref(data.clientId)}?sheet=log-metric`} variant="quiet" size="compact" className={styles.cardAction}>
      + Log metric
    </ButtonLink>
  );
  return (
    <Card className={styles.card} aria-labelledby="body-heading">
      <CardHeadLink href={metricsTabHref(data.clientId)} id="body-heading" title="Body metrics" />
      {data.scans.length === 0 ? (
        <div className={styles.emptyRow}>
          <p className={styles.caption}>Nothing logged yet.</p>
          {logMetric}
        </div>
      ) : (
        <>
          {/* The period only matters once there is something to chart (4 weeks to start with). */}
          <div className={styles.periodRow}>
            <label htmlFor={periodId} className={styles.caption}>Period</label>
            <select id={periodId} className={styles.periodSelect} value={period} onChange={(e) => setPeriod(e.target.value as OverviewPeriod)}>
              {OVERVIEW_PERIODS.map((p) => (
                <option key={p} value={p}>{OVERVIEW_PERIOD_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <ul className={styles.metrics} aria-label="Pick a measure to chart">
            {metrics.map((m) => (
              <li key={m.key}>
                <button
                  type="button"
                  className={styles.metric}
                  aria-pressed={m.key === chosen}
                  onClick={() => setChosen(m.key)}
                >
                  {/* The visible text is the button's name (no aria-label, so speech and screen readers agree). */}
                  <span className={styles.metricLabel}>{SHORT_LABEL[m.key]}</span>
                  <span className={styles.metricValue}>{m.latest ? formatMetric(m.key, m.latest.value, units) : <><span aria-hidden="true">–</span><span className={layout.srOnly}>not measured</span></>}</span>
                  <span className={styles.metricChange}>
                    {m.change !== null ? (
                      <>
                        {formatMetricChange(m.key, m.change, units)}
                        <span className={layout.srOnly}> over {OVERVIEW_PERIOD_LABELS[period].toLowerCase()}</span>
                      </>
                    ) : ' '}
                  </span>
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
          {logMetric ? <div className={styles.cardActions}>{logMetric}</div> : null}
        </>
      )}
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
        : { id: e.id, kind: 'scan', at: e.at, text: `Body scan added for ${dayText(e.measuredOn)}`, href: metricsTabHref(clientId) };
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
