import { describe, expect, it } from 'vitest';
import { STICKERS } from '../../src/awards/catalogue';
import { formatMultiple, instantMs, ladderHistoryBefore, normalizeInstant, pickLadderAnimal, seededRng } from '../../src/awards/ladder';
import type { LadderAward } from '../../src/awards/ladder';

const weight = (key: string) => STICKERS.find((s) => s.key === key)?.weightKg ?? NaN;
const seed = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Worked out once and pinned (seededRng / pickLadderAnimal for one fixed log id).
const PINNED_RNG = [0.7255448899231851, 0.6470094847027212, 0.13913478143513203];
const PINNED_PICK_3000 = 'moose';
const PINNED_PICK_1440 = 'polar-bear';
const SEEDS = Array.from({ length: 60 }, (_, i) => seed(i + 1));

/** A client's workouts in order, each awarded under the rule with the ones before it as history. */
function simulate(volumes: number[]): string[] {
  const awarded: string[] = [];
  volumes.forEach((v, i) => {
    const pick = pickLadderAnimal(v, awarded, seed(1000 + i));
    if (pick) awarded.push(pick.sticker.key);
  });
  return awarded;
}

describe('seededRng', () => {
  it('gives the same numbers in [0, 1) for the same seed, and different ones for another seed', () => {
    const a = seededRng(seed(1));
    const b = seededRng(seed(1));
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    for (const x of first) expect(x >= 0 && x < 1).toBe(true);
    expect(seededRng(seed(2))()).not.toBe(first[0]);
  });
});

describe('pickLadderAnimal', () => {
  it('gives a new client light animals too, never the same one twice, across several workouts', () => {
    // 3,000 kg reaches 25 animals, rabbit to rhino. The old rule gave a rhino every time.
    const picks = simulate(Array.from({ length: 10 }, () => 3000));
    expect(picks).toHaveLength(10);
    expect(new Set(picks).size).toBe(10);
    expect(picks.some((k) => weight(k) < 100)).toBe(true);
    for (const k of picks) expect(weight(k)).toBeLessThanOrEqual(3000);
  });

  it('only picks an animal the volume reaches, with the multiple of that animal', () => {
    for (const s of SEEDS) {
      const pick = pickLadderAnimal(1000, [], s);
      expect(pick).not.toBeNull();
      expect(pick!.sticker.kind).toBe('ladder');
      expect(pick!.sticker.weightKg!).toBeLessThanOrEqual(1000);
      expect(pick!.multiple).toBeCloseTo(1000 / pick!.sticker.weightKg!);
    }
    // Exactly an animal's weight reaches it.
    expect(pickLadderAnimal(2, [], seed(1))?.sticker.key).toBe('rabbit');
  });

  it('never repeats while an eligible animal is still unowned', () => {
    // 10 kg reaches rabbit, cat, red panda and koala; three are owned (and a heavier one, which does not count).
    for (const s of SEEDS) {
      expect(pickLadderAnimal(10, ['rabbit', 'hippo', 'cat', 'koala'], s)?.sticker.key).toBe('red-panda');
    }
  });

  it('once every eligible animal is owned, repeats the one whose last award is oldest', () => {
    // Last awarded: rabbit at 1, red panda at 2, cat at 3. Hippo is not eligible at 5 kg.
    const history = ['cat', 'rabbit', 'red-panda', 'hippo', 'cat'];
    for (const s of SEEDS) expect(pickLadderAnimal(5, history, s)?.sticker.key).toBe('rabbit');
    // Then the order goes round: red panda, cat, rabbit, ...
    expect(simulate([5, 5, 5, 5, 5, 5, 5])).toEqual(
      expect.arrayContaining(['rabbit', 'cat', 'red-panda']),
    );
    const run = simulate([5, 5, 5, 5, 5, 5, 5]);
    expect(run.slice(3)).toEqual([...run.slice(0, 3), run[0]]);
  });

  it('is deterministic: the same log id and history give the same animal', () => {
    for (const s of SEEDS) {
      expect(pickLadderAnimal(3000, ['cat'], s)).toEqual(pickLadderAnimal(3000, ['cat'], s));
    }
    // ...and different log ids spread over the choices.
    expect(new Set(SEEDS.map((s) => pickLadderAnimal(3000, [], s)?.sticker.key)).size).toBeGreaterThan(5);
  });

  it('gives null below the lightest animal when nothing is stored', () => {
    expect(pickLadderAnimal(1.9, [], seed(1))).toBeNull();
    expect(pickLadderAnimal(0, ['rabbit'], seed(1), null)).toBeNull();
  });

  it('keeps a stored animal, with the new multiple', () => {
    for (const s of SEEDS) {
      // Even though cat is owned and others are not.
      expect(pickLadderAnimal(3000, ['cat'], s, 'cat')).toMatchObject({ sticker: { key: 'cat' }, multiple: 750 });
    }
  });

  it('keeps a stored animal forever, even when a correction takes the volume below it', () => {
    for (const s of SEEDS) {
      expect(pickLadderAnimal(400, ['rabbit', 'cat'], s, 'horse')).toMatchObject({ sticker: { key: 'horse' }, multiple: 0.8 });
    }
    expect(pickLadderAnimal(0, [], seed(1), 'rabbit')).toMatchObject({ sticker: { key: 'rabbit' }, multiple: 0 });
  });

  it('ignores a stored key that is not a ladder animal', () => {
    expect(pickLadderAnimal(10, ['rabbit', 'cat', 'koala'], seed(1), 'kakapo')?.sticker.key).toBe('red-panda');
  });

  it('gives pinned answers, so the phone and the server can never drift apart', () => {
    // If one of these changes, every past preview and award would disagree: don't change the generator.
    const r = seededRng('3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b');
    expect([r(), r(), r()]).toEqual(PINNED_RNG);
    expect(pickLadderAnimal(3000, ['cat', 'goat', 'rabbit'], '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b')?.sticker.key).toBe(
      PINNED_PICK_3000,
    );
    expect(pickLadderAnimal(1440, [], '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b')?.sticker.key).toBe(PINNED_PICK_1440);
  });
});

describe('ladderHistoryBefore', () => {
  const a = (logId: string, finishedAt: string, key: string): LadderAward => ({ logId, finishedAt, key });
  const L1 = a(seed(1), '2026-11-01T10:00:00Z', 'cat');
  const L2 = a(seed(2), '2026-11-02T10:00:00Z', 'goat');
  const L3a = a(seed(3), '2026-11-03T10:00:00Z', 'rabbit');
  const L3b = a(seed(4), '2026-11-03T10:00:00Z', 'koala');
  const L4 = a(seed(5), '2026-11-04T10:00:00Z', 'hippo');

  it('lists the animals of logs finished before this one, oldest first, ties by log id', () => {
    const all = [L4, L3b, L2, L3a, L1];
    expect(ladderHistoryBefore(all, { id: seed(4), finishedAt: '2026-11-03T10:00:00Z' })).toEqual(['cat', 'goat', 'rabbit']);
    expect(ladderHistoryBefore(all, { id: seed(9), finishedAt: '2026-11-05T10:00:00Z' })).toEqual([
      'cat',
      'goat',
      'rabbit',
      'koala',
      'hippo',
    ]);
    expect(ladderHistoryBefore(all, { id: seed(1), finishedAt: '2026-11-01T10:00:00Z' })).toEqual([]);
  });

  it('compares instants, not text: the same moment in another offset is the same time', () => {
    const offset = a(seed(6), '2026-11-02T12:00:00+02:00', 'pig'); // 10:00Z, same as L2, later id
    expect(ladderHistoryBefore([L2, offset], { id: seed(7), finishedAt: '2026-11-02T10:00:00.000Z' })).toEqual([
      'goat',
      'pig',
    ]);
    expect(ladderHistoryBefore([L2, offset], { id: seed(6), finishedAt: '2026-11-02T10:00:00Z' })).toEqual(['goat']);
  });

  it('is stable on recompute: later awards never change an earlier log’s pick', () => {
    const log = { id: seed(2), finishedAt: L2.finishedAt };
    const then = pickLadderAnimal(3000, ladderHistoryBefore([L1], log), log.id);
    const now = pickLadderAnimal(3000, ladderHistoryBefore([L1, L2, L3a, L3b, L4], log), log.id);
    expect(now).toEqual(then);
  });
});

describe('Postgres timestamps', () => {
  it('normalises microseconds and +00:00 to an ISO instant every engine parses', () => {
    expect(normalizeInstant('2026-11-07T05:12:19.123456+00:00')).toBe('2026-11-07T05:12:19.123Z');
    expect(normalizeInstant('2026-11-07 05:12:19.1+00')).toBe('2026-11-07T05:12:19.1Z');
    expect(normalizeInstant('2026-11-07T05:12:19+00:00')).toBe('2026-11-07T05:12:19Z');
    expect(normalizeInstant('2026-11-07T07:12:19.987654+02:00')).toBe('2026-11-07T07:12:19.987+02:00');
    expect(normalizeInstant('2026-11-07T05:12:19.000Z')).toBe('2026-11-07T05:12:19.000Z');
    expect(instantMs('2026-11-07T05:12:19.123456+00:00')).toBe(Date.UTC(2026, 10, 7, 5, 12, 19, 123));
  });

  it('orders microsecond timestamps from the database like the same instants in ms', () => {
    const a = (logId: string, finishedAt: string, key: string): LadderAward => ({ logId, finishedAt, key });
    const awards = [
      a(seed(2), '2026-11-02T10:00:00.500999+00:00', 'goat'),
      a(seed(1), '2026-11-02T10:00:00.400001+00:00', 'cat'),
    ];
    expect(ladderHistoryBefore(awards, { id: seed(9), finishedAt: '2026-11-02T10:00:00.450Z' })).toEqual(['cat']);
    expect(ladderHistoryBefore(awards, { id: seed(9), finishedAt: '2026-11-02T10:00:01.000000+00:00' })).toEqual([
      'cat',
      'goat',
    ]);
  });
});

describe('formatMultiple for big and small multiples', () => {
  it('groups thousands', () => {
    expect(formatMultiple(1500, 'Rabbit')).toBe('≈ 1,500 Rabbits');
    expect(formatMultiple(37.6, 'Cat')).toBe('≈ 38 Cats');
    expect(formatMultiple(12345.4, 'Red panda')).toBe('≈ 12,345 Red pandas');
  });
  it('reads fine under 1 (a kept animal after a correction)', () => {
    expect(formatMultiple(0.8, 'Horse')).toBe('≈ 0.8 Horses');
    expect(formatMultiple(0.04, 'Horse')).toBe('< 0.1 Horses');
    expect(formatMultiple(0, 'Horse')).toBe('≈ 0 Horses');
    expect(formatMultiple(0.5, 'Sheep')).toBe('≈ 0.5 Sheep');
  });
});
