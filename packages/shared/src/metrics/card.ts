import { formatPlainDayMonthInYear } from '../dates/format';
import { diffDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import type { Units } from '../units/units';
import { METRIC_CATALOGUE, metricToDisplay, metricUnit } from './catalogue';
import type { MetricEnteredBy, MetricKey } from './catalogue';
import type { MetricEntry } from './summary';

/** The day of a value on a Metrics card: "Today", "Yesterday", "12 Nov", or "2 Mar 2025" in another year. */
export function metricDayText(day: IsoDate, today: IsoDate): string {
  const ago = diffDays(day, today);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  return formatPlainDayMonthInYear(day, today);
}

/**
 * Who or what a value came from, seen by `viewer`: "logged by you", "logged by Maya" (the other person's first name;
 * the client sees "your coach"), "InBody scan", "from Apple Health".
 */
export function metricEntryWho(entry: MetricEntry, viewer: MetricEnteredBy, otherFirstName: string): string {
  if (entry.source === 'inbody_scan') return 'InBody scan';
  if (entry.source === 'apple_health') return 'from Apple Health';
  if (entry.enteredBy === viewer) return 'logged by you';
  if (viewer === 'client') return 'logged by your coach';
  const name = otherFirstName.trim();
  return `logged by ${name || 'the client'}`;
}

/** A card's meta line: "Today · logged by Maya", "12 Nov · InBody scan". */
export function metricEntryMeta(entry: MetricEntry, today: IsoDate, viewer: MetricEnteredBy, otherFirstName: string): string {
  return `${metricDayText(entry.measuredOn, today)} · ${metricEntryWho(entry, viewer, otherFirstName)}`;
}

/** A stored value as its shown number and unit apart (the card draws the number big): { value: "68.4", unit: "kg" }. */
export function metricValueParts(key: MetricKey, stored: number, units: Units): { value: string; unit: string } {
  const def = METRIC_CATALOGUE[key];
  return { value: metricToDisplay(key, stored, units).toFixed(def.decimals), unit: def.kind === 'percent' ? '%' : metricUnit(key, units) };
}
