// Small pure helpers for how the chat reads on screen.

/** Up to two capital letters from a name (first and last); "C" when there is none. */
export function initialsOf(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'C';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** "2:05 pm" in a time zone. Only numbers are taken from Intl (limited locale data on Hermes). */
export function clockTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23', numberingSystem: 'latn' }).formatToParts(new Date(iso));
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const h = num('hour') % 24;
  const m = num('minute');
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
