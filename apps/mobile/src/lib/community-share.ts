// The cards a client can share to the community from the zoo book and a workout summary. Only what is on the card
// reaches other members (never the workout's sets, body measurements or InBody numbers).
import { logVolumeKg, type AwardResult, type CommunityCard, type WorkoutLogDoc } from '@caltracker/shared';
import type { AlbumItem } from './album-logic';

/** A sticker the client owns (locked ones can't be shared). */
export function stickerShareCard(item: AlbumItem): CommunityCard | null {
  if (!item.owned) return null;
  return { kind: 'sticker', stickerKey: item.key, shiny: item.shiny };
}

/** The workout's volume and its animal, from a finished workout. */
export function workoutShareCard(log: WorkoutLogDoc, award: AwardResult | null): CommunityCard | null {
  if (log.status !== 'completed') return null;
  const ladder = award?.ladder ?? null;
  return {
    kind: 'workout',
    logId: log.id,
    workoutName: log.name.slice(0, 120) || 'Workout',
    volumeKg: Math.round(logVolumeKg(log) * 10) / 10,
    stickerKey: ladder?.key ?? null,
    multiple: ladder?.multiple ?? null,
    shiny: ladder?.shiny ?? false,
  };
}

/** Up to 5 personal bests from a finished workout, or null when it set none. */
export function prShareCard(log: WorkoutLogDoc, award: AwardResult | null): CommunityCard | null {
  if (log.status !== 'completed' || !award || award.prs.length === 0) return null;
  const names = new Map<string, string>();
  for (const b of log.blocks) for (const e of b.exercises) names.set(e.exerciseId, e.exerciseName);
  return {
    kind: 'pr',
    logId: log.id,
    workoutName: log.name.slice(0, 120) || 'Workout',
    prs: award.prs.slice(0, 5).map((p) => ({
      exerciseName: (names.get(p.exerciseId) ?? 'Exercise').slice(0, 120),
      prKind: p.kind,
      valueKg: p.valueKg,
      reps: p.reps,
    })),
  };
}

/** The route that opens the composer with a card attached. */
export const shareHref = (card: CommunityCard) => ({ pathname: '/community/new' as const, params: { card: JSON.stringify(card) } });
