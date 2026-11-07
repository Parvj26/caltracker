// What a client can share to the community from the zoo book and a workout summary. The phone only says which
// sticker or which workout; the database builds the card from its own records (the zoo book, the workout log and its
// stored award), so no number on a card comes from the phone. Never the sets, body measurements or InBody numbers.
import type { AwardResult, CardRequest, WorkoutLogDoc } from '@caltracker/shared';
import type { AlbumItem } from './album-logic';

/** A sticker the client owns (locked ones can't be shared). */
export function stickerShareCard(item: AlbumItem): CardRequest | null {
  return item.owned ? { kind: 'sticker', stickerKey: item.key } : null;
}

/**
 * A finished workout, once the server has its award (which also means the log has synced): the database builds the
 * card from the log and that award, so before then there is nothing to share yet.
 */
export function workoutShareCard(log: WorkoutLogDoc, award: AwardResult | null): CardRequest | null {
  return log.status === 'completed' && award ? { kind: 'workout', logId: log.id } : null;
}

/** Shown on a finished workout whose award isn't on the server yet. */
export const SHARE_NOT_READY = 'Sharing is ready once your workout finishes syncing.';

/** The personal bests a finished workout set, when the stored award has any. */
export function prShareCard(log: WorkoutLogDoc, award: AwardResult | null): CardRequest | null {
  if (log.status !== 'completed' || !award || award.prs.length === 0) return null;
  return { kind: 'pr', logId: log.id };
}

/** A friendly message for create_community_post's refusals (never the raw database error). */
export function postErrorMessage(code: string | undefined, withCard: boolean): string {
  if (withCard && code === '42501') return 'You can only share your own stickers and finished workouts.';
  if (withCard && code === '22023') return 'That can’t be shared yet. Try again once your workout has synced.';
  if (code === '42501') return 'You can’t post in the community right now.';
  if (code === '23514' || code === '22023') return 'That post couldn’t be saved. Check the text and photos and try again.';
  return 'Couldn’t post. Please try again.';
}

/** The route that opens the composer with a card attached. */
export const shareHref = (card: CardRequest) => ({ pathname: '/community/new' as const, params: { card: JSON.stringify(card) } });
