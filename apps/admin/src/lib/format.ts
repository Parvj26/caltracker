/** Plain-language times and counts for the admin pages (the mockups' wording). */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "just now", "1 min ago", "2 h ago", "3 days ago"; "never" for no time. */
export function agoLabel(iso: string | null | undefined, now: Date): string {
  if (!iso) return 'never';
  const ms = now.getTime() - Date.parse(iso);
  if (Number.isNaN(ms)) return 'never';
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  return `${plural(Math.floor(ms / DAY), 'day')} ago`;
}

/** How long a problem has lasted: "today", "1 day", "2 days"; "—" for no time. */
export function sinceLabel(iso: string | null | undefined, now: Date): string {
  if (!iso) return '—';
  const ms = now.getTime() - Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  const days = Math.floor(ms / DAY);
  return days < 1 ? 'today' : plural(days, 'day');
}

/** "▲ 2 vs last", "▼ 4 vs last" or "same as last". */
export function trendLabel(thisWeek: number, lastWeek: number): string {
  const diff = thisWeek - lastWeek;
  if (diff === 0) return 'same as last';
  return `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} vs last`;
}

function parts(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, ...options }).format(date);
}

/** Timeline "When": the time for today ("7:05 pm"), the weekday within a week ("Fri"), else the date ("20 Oct"). */
export function whenLabel(iso: string, now: Date, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const day = (d: Date) => parts(d, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (day(at) === day(now)) {
    return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true })
      .format(at)
      .replace(/\s?([AP])M$/i, (_m, p: string) => ` ${p.toLowerCase()}m`);
  }
  if (now.getTime() - at.getTime() < 6 * DAY) return parts(at, timeZone, { weekday: 'short' });
  return parts(at, timeZone, { day: 'numeric', month: 'short' });
}

/** "7 Nov 2026". */
export function dateLabel(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '—' : parts(at, timeZone, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "1.0.0 (2) · 2 phones, 0.9.0 · 1 phone"; "none yet" when no phone has the app. */
export function appVersionsLabel(versions: ReadonlyArray<{ version: string; devices: number }>): string {
  if (versions.length === 0) return 'none yet';
  return versions.map((v) => `${v.version} · ${plural(v.devices, 'phone')}`).join(', ');
}
