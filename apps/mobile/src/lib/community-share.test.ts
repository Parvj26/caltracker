import { describe, expect, it } from 'vitest';
import { CardRequest, type AwardResult } from '@caltracker/shared';
import type { AlbumItem } from './album-logic';
import { prShareCard, shareHref, stickerShareCard, workoutShareCard } from './community-share';
import { sampleLog } from './log-fixtures';

const completedLog = () => sampleLog({ status: 'completed', finishedAt: '2026-11-05T10:00:00.000Z' });

const item = (owned: boolean): AlbumItem => ({
  key: 'cat',
  name: 'Cat',
  fact: '',
  kind: 'ladder',
  owned,
  count: owned ? 1 : 0,
  shiny: true,
  badge: null,
  firstEarnedAt: null,
  requirement: null,
});

const award = (prs: AwardResult['prs']): AwardResult => ({ ladder: null, drop: null, rare: [], landmarks: [], milestone: null, prs });

describe('community share requests', () => {
  it('asks for an owned sticker by key only (shiny comes from the database)', () => {
    expect(stickerShareCard(item(false))).toBeNull();
    expect(stickerShareCard(item(true))).toEqual({ kind: 'sticker', stickerKey: 'cat' });
  });

  it('asks for a finished workout by id only', () => {
    const log = completedLog();
    const card = workoutShareCard(log);
    expect(card).toEqual({ kind: 'workout', logId: log.id });
    expect(CardRequest.safeParse(card).success).toBe(true);
    expect(workoutShareCard({ ...log, status: 'in_progress' })).toBeNull();
  });

  it('offers PRs only when the award has some', () => {
    const log = completedLog();
    const pr = { exerciseId: 'x', kind: 'heaviest' as const, valueKg: 100, reps: null, logId: log.id, achievedAt: '2026-11-06T10:00:00Z' };
    expect(prShareCard(log, award([pr]))).toEqual({ kind: 'pr', logId: log.id });
    expect(prShareCard(log, award([]))).toBeNull();
    expect(prShareCard(log, null)).toBeNull();
  });

  it('passes the request to the composer as JSON', () => {
    const href = shareHref({ kind: 'sticker', stickerKey: 'cat' });
    expect(href.pathname).toBe('/community/new');
    expect(JSON.parse(href.params.card)).toEqual({ kind: 'sticker', stickerKey: 'cat' });
  });
});
