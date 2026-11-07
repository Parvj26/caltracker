// What a client can share to the community from the zoo book and a workout summary. The phone only says which
// sticker or which workout; the database builds the card from its own records (the zoo book, the workout log and its
// stored award), so no number on a card comes from the phone. Never the sets, body measurements or InBody numbers.
import type { AwardResult, CardRequest, WorkoutLogDoc } from '@caltracker/shared';
import type { AlbumItem } from './album-logic';

/** A sticker the client owns (locked ones can't be shared). */
export function stickerShareCard(item: AlbumItem): CardRequest | null {
  return item.owned ? { kind: 'sticker', stickerKey: item.key } : null;
}

/** A finished workout. */
export function workoutShareCard(log: WorkoutLogDoc): CardRequest | null {
  return log.status === 'completed' ? { kind: 'workout', logId: log.id } : null;
}

/** The personal bests a finished workout set, when the stored award has any. */
export function prShareCard(log: WorkoutLogDoc, award: AwardResult | null): CardRequest | null {
  if (log.status !== 'completed' || !award || award.prs.length === 0) return null;
  return { kind: 'pr', logId: log.id };
}

/** The route that opens the composer with a card attached. */
export const shareHref = (card: CardRequest) => ({ pathname: '/community/new' as const, params: { card: JSON.stringify(card) } });
