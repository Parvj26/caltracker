import { describe, expect, it } from 'vitest';
import { CommunityCard, type AwardResult } from '@caltracker/shared';
import type { AlbumItem } from './album-logic';
import { prShareCard, shareHref, stickerShareCard, workoutShareCard } from './community-share';
import { sampleLog } from './log-fixtures';

const completedLog = () => sampleLog({ status: 'completed', finishedAt: '2026-11-05T10:00:00.000Z' });

const item = (owned: boolean, shiny = false): AlbumItem => ({
  key: 'cat',
  name: 'Cat',
  fact: '',
  kind: 'ladder',
  owned,
  count: owned ? 1 : 0,
  shiny,
  badge: null,
  firstEarnedAt: null,
  requirement: null,
});

describe('community share cards', () => {
  it('shares only stickers the client owns', () => {
    expect(stickerShareCard(item(false))).toBeNull();
    expect(stickerShareCard(item(true, true))).toEqual({ kind: 'sticker', stickerKey: 'cat', shiny: true });
  });

  it('builds a workout card the database and schema accept', () => {
    const log = completedLog();
    const award: AwardResult = { ladder: { key: 'cat', multiple: 2, isNew: true, count: 1, shiny: false }, drop: null, rare: [], landmarks: [], milestone: null, prs: [] };
    const card = workoutShareCard(log, award);
    expect(card).toMatchObject({ kind: 'workout', logId: log.id, stickerKey: 'cat', multiple: 2 });
    expect(CommunityCard.safeParse(card).success).toBe(true);
    expect(workoutShareCard({ ...log, status: 'in_progress' }, award)).toBeNull();
  });

  it('builds a PR card with exercise names, only when there are PRs', () => {
    const log = completedLog();
    const exerciseId = log.blocks[0].exercises[0].exerciseId;
    const award: AwardResult = {
      ladder: null,
      drop: null,
      rare: [],
      landmarks: [],
      milestone: null,
      prs: [{ exerciseId, kind: 'heaviest', valueKg: 100, reps: null, logId: log.id, achievedAt: '2026-11-06T10:00:00Z' }],
    };
    const card = prShareCard(log, award);
    expect(card).toMatchObject({ kind: 'pr', prs: [{ exerciseName: log.blocks[0].exercises[0].exerciseName, prKind: 'heaviest', valueKg: 100 }] });
    expect(CommunityCard.safeParse(card).success).toBe(true);
    expect(prShareCard(log, { ...award, prs: [] })).toBeNull();
    expect(prShareCard(log, null)).toBeNull();
  });

  it('passes the card to the composer as JSON', () => {
    const href = shareHref({ kind: 'sticker', stickerKey: 'cat', shiny: false });
    expect(href.pathname).toBe('/community/new');
    expect(JSON.parse(href.params.card)).toEqual({ kind: 'sticker', stickerKey: 'cat', shiny: false });
  });
});
