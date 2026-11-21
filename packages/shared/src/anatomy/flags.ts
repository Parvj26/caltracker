import type { IsoDate } from '../dates/dates';
import { bodyRegion, isBodyRegionId, regionBothName, regionSideName, type BodyRegionId } from './muscles';

/**
 * Flags: the coach's open pains, injuries and limitations for a client (public.client_flags), shown on the client's
 * Overview, the session logger, Training now and the workout builder. Coach-only: the client never reads them.
 */

export const FLAG_TYPES = ['pain', 'injury', 'limitation'] as const;
export type FlagType = (typeof FLAG_TYPES)[number];
export const FLAG_TYPE_LABELS: Record<FlagType, string> = { pain: 'Pain', injury: 'Injury', limitation: 'Limitation' };

/** The client's left or right, both sides, or the middle (a midline region, or a General flag with no region). */
export const FLAG_SIDES = ['L', 'R', 'both', 'centre'] as const;
export type FlagSide = (typeof FLAG_SIDES)[number];
export const FLAG_SIDE_LABELS: Record<FlagSide, string> = { L: 'L', R: 'R', both: 'Both', centre: 'Centre' };

export const FLAG_NOTE_MAX_LENGTH = 2000;

export type ClientFlag = {
  id: string;
  /** A catalogue id (muscles.ts), or null for a General flag (a note moved over from the old free-text field). */
  region: BodyRegionId | null;
  side: FlagSide;
  type: FlagType;
  since: IsoDate;
  note: string;
  status: 'open' | 'resolved';
  resolvedOn: IsoDate | null;
  createdAt: string;
};

/** The sides a coach can pick for a region: L, R, Both, plus Centre on a midline one; only Centre for abs. */
export function flagSidesFor(region: BodyRegionId | null): readonly FlagSide[] {
  if (region === null) return ['centre'];
  const r = bodyRegion(region);
  if (!r) return ['centre'];
  if (r.sides === 'none') return ['centre'];
  return r.midline ? ['L', 'R', 'both', 'centre'] : ['L', 'R', 'both'];
}

/** The side a new flag starts on: Centre on a midline region (as the board's neck), else the side tapped, else Left. */
export function defaultFlagSide(region: BodyRegionId | null, tapped?: 'L' | 'R'): FlagSide {
  const sides = flagSidesFor(region);
  if (sides.includes('centre')) return 'centre';
  return tapped ?? 'L';
}

/** "Neck", "Left knee", "Both knees", "General". */
export function flagPlace(flag: Pick<ClientFlag, 'region' | 'side'>): string {
  if (flag.region === null || !isBodyRegionId(flag.region)) return 'General';
  if (flag.side === 'both') return regionBothName(flag.region);
  if (flag.side === 'centre') return bodyRegion(flag.region)!.name;
  return regionSideName(flag.region, flag.side);
}

/** The first line of a note, without a list mark or one closing full stop. */
function firstLine(note: string): string | null {
  const line = note
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-•*]\s*/, '').trim())
    .find((l) => l.length > 0);
  if (line === undefined) return null;
  return /[^.]\.$/.test(line) ? line.slice(0, -1) : line;
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * One flag in a few words, for the amber chip and the builder's reminder: "Neck pain", "Left knee injury",
 * "Left knee: no deep squats" (a limitation says what to avoid). A General flag is its note's first line.
 */
export function flagHeadline(flag: Pick<ClientFlag, 'region' | 'side' | 'type' | 'note'>): string {
  const line = firstLine(flag.note);
  if (flag.region === null || !isBodyRegionId(flag.region)) return line ?? `General ${flag.type}`;
  const place = flagPlace(flag);
  if (flag.type === 'limitation') return line ? `${place}: ${lowerFirst(line)}` : `${place} limitation`;
  return `${place} ${flag.type}`;
}

/** Open flags, newest first (by since date, then when they were added). */
export function openFlagsNewestFirst<T extends Pick<ClientFlag, 'status' | 'since' | 'createdAt'>>(flags: readonly T[]): T[] {
  return flags
    .filter((f) => f.status === 'open')
    .sort((a, b) => (a.since === b.since ? b.createdAt.localeCompare(a.createdAt) : b.since.localeCompare(a.since)));
}

/** Resolved flags, most recently resolved first. */
export function resolvedFlags<T extends Pick<ClientFlag, 'status' | 'resolvedOn' | 'createdAt'>>(flags: readonly T[]): T[] {
  return flags
    .filter((f) => f.status === 'resolved')
    .sort((a, b) => ((a.resolvedOn ?? '') === (b.resolvedOn ?? '') ? b.createdAt.localeCompare(a.createdAt) : (b.resolvedOn ?? '').localeCompare(a.resolvedOn ?? '')));
}

/** The amber chip: the newest open flag's headline and how many more are open ("Neck pain", +1 more). */
export function flagChipSummary(flags: readonly ClientFlag[]): { first: string; more: number } | null {
  const open = openFlagsNewestFirst(flags);
  const [first] = open;
  if (!first) return null;
  return { first: flagHeadline(first), more: open.length - 1 };
}

/**
 * The builder's reminder line: "Vaishali: Neck pain (20 Nov) · Left knee: no deep squats". Pains and injuries say
 * since when; open flags newest first. Null when nothing is open.
 */
export function flagReminderText(firstName: string, flags: readonly ClientFlag[], formatDay: (d: IsoDate) => string): string | null {
  const open = openFlagsNewestFirst(flags);
  if (open.length === 0) return null;
  const parts = open.map((f) => (f.type === 'limitation' ? flagHeadline(f) : `${flagHeadline(f)} (${formatDay(f.since)})`));
  return `${firstName}: ${parts.join(' · ')}`;
}

export type FlagInput = { region: string | null; side: string; type: string; since: string; note: string };
export type FlagCheck =
  | { ok: true; value: { region: BodyRegionId | null; side: FlagSide; type: FlagType; since: IsoDate; note: string } }
  | { ok: false; field: 'region' | 'side' | 'type' | 'since' | 'note'; error: string };

/** Checks a new flag before it is saved (the database checks the same). `today` is the coach's local date. */
export function validateFlag(input: FlagInput, today: IsoDate): FlagCheck {
  const region = input.region === null || input.region === '' ? null : input.region;
  if (region !== null && !isBodyRegionId(region)) return { ok: false, field: 'region', error: 'Pick a body part.' };
  if (!(FLAG_TYPES as readonly string[]).includes(input.type)) return { ok: false, field: 'type', error: 'Pick Pain, Injury or Limitation.' };
  if (!(flagSidesFor(region) as readonly string[]).includes(input.side)) return { ok: false, field: 'side', error: 'Pick a side.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.since) || Number.isNaN(Date.parse(`${input.since}T00:00:00Z`)) || input.since < '2000-01-01') {
    return { ok: false, field: 'since', error: 'Enter a date.' };
  }
  if (input.since > today) return { ok: false, field: 'since', error: 'Pick today or an earlier day.' };
  const note = input.note.trim();
  if (note.length > FLAG_NOTE_MAX_LENGTH) return { ok: false, field: 'note', error: `Keep the note to ${FLAG_NOTE_MAX_LENGTH} characters.` };
  return { ok: true, value: { region, side: input.side as FlagSide, type: input.type as FlagType, since: input.since, note } };
}
