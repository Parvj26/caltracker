import { describe, expect, it } from 'vitest';
import { STICKERS } from '../../src/awards/catalogue';
import { animalAmount } from '../../src/awards/ladder';
import { lifetimeAnimalLine, zooTile } from '../../src/progress/zoo';

const ladder = STICKERS.filter((s) => s.kind === 'ladder').sort((a, b) => (a.weightKg ?? 0) - (b.weightKg ?? 0));
const lightest = ladder[0]!;
const heaviest = ladder.at(-1)!;

describe('lifetimeAnimalLine', () => {
  it('compares the lifetime volume with the heaviest animal it beats, in the app’s words', () => {
    const kg = heaviest.weightKg! * 2;
    const a = animalAmount(2, heaviest.name);
    expect(lifetimeAnimalLine(kg)).toBe(`about as much as 2 ${a.noun.toLowerCase()}`);
  });
  it('uses the lightest animal when that is the only one it beats', () => {
    const second = ladder[1]!;
    const kg = Math.min(second.weightKg! - 1, lightest.weightKg! * 1.5);
    expect(lifetimeAnimalLine(kg)).toMatch(new RegExp(`^about as much as [0-9.]+ ${lightest.name.toLowerCase()}`));
  });
  it('is null under the lightest animal', () => {
    expect(lifetimeAnimalLine(0)).toBeNull();
    expect(lifetimeAnimalLine(lightest.weightKg! / 2)).toBeNull();
  });
});

describe('zooTile', () => {
  it('counts the stickers collected and compares the lifetime volume', () => {
    const t = zooTile(27, heaviest.weightKg! * 2, 'kg');
    expect(t.value).toBe('27 stickers');
    expect(t.sub).toMatch(/ lifted, about as much as 2 /);
    expect(zooTile(1, 0, 'kg')).toEqual({ value: '1 sticker', sub: 'your animals and rare finds' });
  });
});
