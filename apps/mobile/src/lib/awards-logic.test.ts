import { describe, expect, it } from 'vitest';
import { ladderHistoryBefore, pickLadderAnimal, type AwardResult, type LadderAward } from '@caltracker/shared';
import {
  NEW_PILL,
  buildRevealCards,
  emptyLadderCache,
  ladderAwardsFrom,
  ladderCacheKey,
  parseLadderCache,
  previewLadder,
  withLocalPick,
  withServerAwards,
  classifyAwardFailure,
  createRevealQueue,
  expired,
  pendingKey,
  prPills,
  summaryStickers,
  surpriseCards,
} from './awards-logic';
import { memoryStorage, sampleLog } from './log-fixtures';

const empty: AwardResult = { ladder: null, drop: null, rare: [], landmarks: [], milestone: null, prs: [] };

// sampleLog's set is a completed or open 60 kg x 8 set; build a completed 1,440 kg log.
function weightedLog(kg: number) {
  const base = sampleLog({ status: 'completed' });
  const ex = base.blocks[0].exercises[0];
  const set = { ...ex.sets[0], actualWeightKg: kg, actualReps: 1, completedAt: '2026-11-05T09:05:00.000Z' };
  return { ...base, finishedAt: '2026-11-05T09:10:00.000Z', blocks: [{ ...base.blocks[0], exercises: [{ ...ex, sets: [set] }] }] };
}
function cardioLog() {
  const base = sampleLog({ status: 'completed' });
  const ex = base.blocks[0].exercises[0];
  const set = { ...ex.sets[0], actualWeightKg: null, actualReps: null, completedAt: '2026-11-05T09:05:00.000Z' };
  return { ...base, blocks: [{ ...base.blocks[0], exercises: [{ ...ex, trackingType: 'time' as const, sets: [set] }] }] };
}

describe('buildRevealCards', () => {
  it('shows the ladder animal from the local log with no server answer, without a pill', () => {
    const cards = buildRevealCards(weightedLog(1440), null, 'lb', []);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ type: 'ladder', lead: 'You lifted 3,175 lb', lead2: 'that’s about', pill: null });
    expect(cards[0].headline).toMatch(/^\d+(,\d{3})*(\.\d)? .+!$/);
  });

  it('previews the same animal the server picks: same rule, same log id, same history', () => {
    const log = weightedLog(1440);
    const history: LadderAward[] = [
      { logId: 'a', finishedAt: '2026-11-01T10:00:00Z', key: 'cat' },
      { logId: 'b', finishedAt: '2026-11-02T10:00:00Z', key: 'giraffe' },
      // Finished after this log: never counts for it.
      { logId: 'z', finishedAt: '2099-01-01T00:00:00Z', key: 'rabbit' },
    ];
    const server = pickLadderAnimal(1440, ladderHistoryBefore(history, { id: log.id, finishedAt: log.finishedAt }), log.id);
    expect(previewLadder(log, history)?.sticker.key).toBe(server?.sticker.key);
    expect(buildRevealCards(log, null, 'lb', history)[0].stickerKey).toBe(server?.sticker.key);
    expect(['cat', 'giraffe']).not.toContain(previewLadder(log, history)?.sticker.key);
  });

  it('has no ladder card for a log with no weighted sets, and no crash', () => {
    expect(buildRevealCards(cardioLog(), null, 'lb', [])).toEqual([]);
    const award = { ...empty, milestone: 10 };
    expect(buildRevealCards(cardioLog(), award, 'lb', []).map((c) => c.type)).toEqual(['milestone']);
  });

  it('merges the server award: ladder, drop, rare, landmark, milestone in that order', () => {
    const award: AwardResult = {
      ladder: { key: 'giraffe', multiple: 1.4, isNew: true, count: 1, shiny: false },
      drop: 'axolotl',
      rare: ['bison'],
      landmarks: ['petra'],
      milestone: 10,
      prs: [],
    };
    const cards = buildRevealCards(weightedLog(1440), award, 'lb', []);
    expect(cards.map((c) => c.type)).toEqual(['ladder', 'drop', 'rare', 'landmark', 'milestone']);
    expect(cards[0]).toMatchObject({ headline: '1.4 Giraffes!', pill: NEW_PILL });
    expect(cards[1].pill).toBe(NEW_PILL);
  });

  it('words a repeat as Another X ×N, and shiny as Shiny X', () => {
    const repeat: AwardResult = { ...empty, ladder: { key: 'giraffe', multiple: 1.4, isNew: false, count: 4, shiny: false } };
    expect(buildRevealCards(weightedLog(1440), repeat, 'lb', [])[0]).toMatchObject({ headline: 'Another giraffe! ×4', pill: null });
    const shiny: AwardResult = { ...empty, ladder: { key: 'giraffe', multiple: 1, isNew: true, count: 1, shiny: true } };
    expect(buildRevealCards(weightedLog(1440), shiny, 'lb', [])[0]).toMatchObject({ headline: '✦ Shiny giraffe!', shiny: true });
  });
});

describe('the ladder history on the phone', () => {
  const NOW = Date.parse('2026-11-06T12:00:00Z');
  const a = (logId: string, finishedAt: string, key: string): LadderAward => ({ logId, finishedAt, key });
  const s1 = a('s1', '2026-11-01T10:00:00Z', 'cat');
  const s2 = a('s2', '2026-11-02T10:00:00Z', 'goat');

  it('keeps one cache per user and coach', () => {
    expect(ladderCacheKey('u1', 'w1')).not.toBe(ladderCacheKey('u1', 'w2'));
    expect(ladderCacheKey('u1', 'w1')).not.toBe(ladderCacheKey('u2', 'w1'));
  });

  it('reads back what it wrote, and an unreadable cache as empty', () => {
    const cache = withLocalPick(withServerAwards(emptyLadderCache, [s1]), a('p1', '2026-11-06T10:00:00Z', 'pig'));
    expect(parseLadderCache(JSON.stringify(cache))).toEqual(cache);
    expect(parseLadderCache(null)).toEqual(emptyLadderCache);
    expect(parseLadderCache('{oops')).toEqual(emptyLadderCache);
    expect(parseLadderCache(JSON.stringify({ server: [{ logId: 1 }], local: 'x' }))).toEqual(emptyLadderCache);
  });

  it('counts the phone’s own previews until the server has awarded those logs', () => {
    const offline = a('p1', '2026-11-06T10:00:00Z', 'pig');
    let cache = withLocalPick(withServerAwards(emptyLadderCache, [s1, s2]), offline);
    expect(ladderAwardsFrom(cache, NOW).map((x) => x.key)).toEqual(['cat', 'goat', 'pig']);
    // The server has awarded it now (maybe another animal): its answer replaces the preview.
    cache = withServerAwards(cache, [s1, s2, a('p1', offline.finishedAt, 'horse')]);
    expect(cache.local).toEqual([]);
    expect(ladderAwardsFrom(cache, NOW).map((x) => x.key)).toEqual(['cat', 'goat', 'horse']);
  });

  it('replaces a preview for the same log, and forgets previews older than a week', () => {
    let cache = withLocalPick(emptyLadderCache, a('p1', '2026-11-06T10:00:00Z', 'pig'));
    cache = withLocalPick(cache, a('p1', '2026-11-06T10:00:00Z', 'cow'));
    expect(cache.local.map((x) => x.key)).toEqual(['cow']);
    const old = withLocalPick(emptyLadderCache, a('p0', '2026-10-20T10:00:00Z', 'pig'));
    expect(ladderAwardsFrom(old, NOW)).toEqual([]);
  });
});

describe('surpriseCards', () => {
  it('skips the ladder card unless it turned out shiny, and titles the rest Surprise!', () => {
    const award: AwardResult = {
      ...empty,
      ladder: { key: 'giraffe', multiple: 1.4, isNew: true, count: 1, shiny: false },
      drop: 'axolotl',
    };
    const cards = surpriseCards(award, 'lb', 1440);
    expect(cards.map((c) => c.type)).toEqual(['drop']);
    expect(cards[0].lead).toBe('Surprise!');
    const shiny = { ...award, ladder: { ...award.ladder!, shiny: true } };
    expect(surpriseCards(shiny, 'lb', 1440).map((c) => c.type)).toEqual(['ladder', 'drop']);
  });
});

describe('the pending reveal queue', () => {
  const entry = (logId: string, result: AwardResult | null = null) => ({ logId, at: '2026-11-05T10:00:00.000Z', volumeKg: 100, result });

  it('persists under the per-user key and survives a new queue over the same storage', async () => {
    const storage = memoryStorage();
    await createRevealQueue(storage, 'u1').add(entry('a'));
    expect(storage.map.has(pendingKey('u1'))).toBe(true);
    expect(pendingKey('u1')).toBe('caltracker.pendingReveals.u1');
    expect((await createRevealQueue(storage, 'u1').list()).map((e) => e.logId)).toEqual(['a']);
    expect(await createRevealQueue(storage, 'u2').list()).toEqual([]);
  });

  it('dedupes by logId and never replaces a known result with null', async () => {
    const q = createRevealQueue(memoryStorage(), 'u1');
    const award = { ...empty, drop: 'axolotl' };
    await Promise.all([q.add(entry('a')), q.add(entry('a', award)), q.add(entry('b'))]);
    await q.add(entry('a'));
    const list = await q.list();
    expect(list.map((e) => e.logId).sort()).toEqual(['a', 'b']);
    expect(list.find((e) => e.logId === 'a')!.result).toEqual(award);
  });

  it('removes an entry, and the key when it was the last', async () => {
    const storage = memoryStorage();
    const q = createRevealQueue(storage, 'u1');
    await q.add(entry('a'));
    await q.remove('a');
    expect(storage.map.has(pendingKey('u1'))).toBe(false);
  });

  it('treats a corrupt value as empty', async () => {
    const storage = memoryStorage();
    storage.map.set(pendingKey('u1'), '{nope');
    expect(await createRevealQueue(storage, 'u1').list()).toEqual([]);
  });

  it('expires old entries', () => {
    expect(expired(entry('a'), Date.parse('2026-11-20T00:00:00Z'))).toBe(true);
    expect(expired(entry('a'), Date.parse('2026-11-06T00:00:00Z'))).toBe(false);
  });
});

describe('classifyAwardFailure', () => {
  it('shows nothing and queues nothing for a removed client', () => {
    expect(classifyAwardFailure(403, 'not_a_client')).toBe('none');
  });
  it('retries while the finished log is not on the server yet', () => {
    expect(classifyAwardFailure(409, null)).toBe('retry');
    expect(classifyAwardFailure(404, null)).toBe('retry');
  });
  it('queues network failures and server errors', () => {
    expect(classifyAwardFailure(null, null)).toBe('later');
    expect(classifyAwardFailure(500, null)).toBe('later');
    expect(classifyAwardFailure(401, null)).toBe('later');
  });
});

describe('the summary row', () => {
  it('lists the ladder animal with its count, then the other stickers', () => {
    const award: AwardResult = {
      ...empty,
      ladder: { key: 'giraffe', multiple: 1.4, isNew: true, count: 1, shiny: false },
      drop: 'axolotl',
      landmarks: ['petra'],
    };
    expect(summaryStickers(award).map((s) => s.label)).toEqual(['Giraffe ×1', expect.any(String), expect.any(String)]);
    expect(summaryStickers(empty)).toEqual([]);
  });

  it('words a personal best with the exercise name', () => {
    const log = weightedLog(100);
    const ex = log.blocks[0].exercises[0];
    const award: AwardResult = {
      ...empty,
      prs: [{ exerciseId: ex.exerciseId, kind: 'heaviest', valueKg: 100, reps: 1, logId: log.id, achievedAt: log.startedAt }],
    };
    expect(prPills(award, log)).toEqual(['Bench press: heaviest']);
  });
});
