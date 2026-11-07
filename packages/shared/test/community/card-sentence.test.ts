import { describe, expect, it } from 'vitest';
import { cardText, posterFirstName, workoutCardSentence } from '../../src/community/cards';
import { parseCard, type CommunityCard } from '../../src/community/schema';
import { formatMultiple } from '../../src/awards/ladder';
import { formatTotalWeight, formatWeight, groupThousands } from '../../src/units/units';
import { formatLogVolume } from '../../src/logs/format';

const LOG = '00000000-0000-4000-8000-000000000001';
type WorkoutCard = Extract<CommunityCard, { kind: 'workout' }>;
const workout = (over: Partial<WorkoutCard> = {}): WorkoutCard => ({
  kind: 'workout',
  logId: LOG,
  workoutName: 'VK Upper',
  finishedAt: null,
  exerciseCount: 11,
  setCount: 10,
  stickerKey: 'cow',
  multiple: 1,
  shiny: false,
  volumeKg: 698.53,
  ...over,
});

describe('posterFirstName', () => {
  it('uses the first word of the display name', () => {
    expect(posterFirstName('Vaishali Kapoor')).toBe('Vaishali');
    expect(posterFirstName('  Vaishali  ')).toBe('Vaishali');
    expect(posterFirstName('You')).toBe('You');
  });
  it('never makes "Former" a name', () => {
    expect(posterFirstName('Former member')).toBe('A former member');
    expect(posterFirstName('')).toBe('A former member');
  });
});

describe('workoutCardSentence', () => {
  it('says what the poster lifted, in the viewer’s units, and the animal in plain words', () => {
    expect(workoutCardSentence(workout(), 'lb', 'Vaishali Kapoor')).toBe('Vaishali lifted 1,540 lb — about as much as 1 cow 🐄');
    expect(workoutCardSentence(workout(), 'kg', 'Vaishali Kapoor')).toBe('Vaishali lifted 699 kg — about as much as 1 cow 🐄');
  });
  it('pluralises the animal, and keeps one decimal under 1', () => {
    expect(workoutCardSentence(workout({ stickerKey: 'corgi', multiple: 14.2, volumeKg: 170 }), 'kg', 'Sam')).toBe(
      'Sam lifted 170 kg — about as much as 14 corgis 🐕',
    );
    expect(workoutCardSentence(workout({ stickerKey: 'horse', multiple: 0.8, volumeKg: 400 }), 'kg', 'Sam')).toBe(
      'Sam lifted 400 kg — about as much as 0.8 horses 🐎',
    );
    expect(workoutCardSentence(workout({ stickerKey: 'sheep', multiple: 3, volumeKg: 240 }), 'kg', 'Sam')).toBe(
      'Sam lifted 240 kg — about as much as 3 sheep 🐑',
    );
    expect(workoutCardSentence(workout({ stickerKey: 'walrus', multiple: 2, volumeKg: 2000 }), 'kg', 'Sam')).toBe(
      'Sam lifted 2,000 kg — about as much as 2 walruses',
    );
  });
  it('says "less than" for a sliver of an animal', () => {
    expect(workoutCardSentence(workout({ stickerKey: 'horse', multiple: 0.02, volumeKg: 10 }), 'kg', 'Sam')).toBe(
      'Sam lifted 10 kg — less than 0.1 horses 🐎',
    );
  });
  it('lowercases two-word animals', () => {
    expect(workoutCardSentence(workout({ stickerKey: 'polar-bear', multiple: 2.5, volumeKg: 1125 }), 'kg', 'Sam')).toBe(
      'Sam lifted 1,125 kg — about as much as 2.5 polar bears 🐻‍❄️',
    );
  });
  it('says only what was lifted when there is no animal', () => {
    expect(workoutCardSentence(workout({ stickerKey: null, multiple: null, volumeKg: 1 }), 'kg', 'Sam')).toBe('Sam lifted 1 kg');
  });
  it('has no sentence without a stored volume (older cards) or with nothing weighed', () => {
    expect(workoutCardSentence(workout({ volumeKg: undefined }), 'kg', 'Sam')).toBeNull();
    expect(workoutCardSentence(workout({ volumeKg: null }), 'kg', 'Sam')).toBeNull();
    expect(workoutCardSentence(workout({ volumeKg: 0 }), 'kg', 'Sam')).toBeNull();
  });
});

describe('cardText', () => {
  it('a workout card: the sentence is the headline, the name and counts are below', () => {
    expect(cardText(workout(), 'lb', 'Vaishali Kapoor')).toEqual({
      badge: null,
      title: 'Vaishali lifted 1,540 lb — about as much as 1 cow 🐄',
      lines: ['VK Upper', '11 exercises · 10 sets'],
      stickerKey: 'cow',
      shiny: false,
    });
  });
  it('a workout card without a stored volume keeps the older style, without the weight', () => {
    expect(cardText(workout({ volumeKg: undefined }), 'lb', 'Vaishali')).toEqual({
      badge: 'Workout done',
      title: 'VK Upper',
      lines: ['11 exercises · 10 sets', '≈ 1 Cow'],
      stickerKey: 'cow',
      shiny: false,
    });
    expect(cardText(workout({ volumeKg: null, stickerKey: null, multiple: null, exerciseCount: 1, setCount: 1 }), 'kg', 'V').lines).toEqual([
      '1 exercise · 1 set',
    ]);
  });
  it('a sticker card', () => {
    expect(cardText({ kind: 'sticker', stickerKey: 'lion', shiny: false, count: 1 }, 'kg', 'Vaishali Kapoor')).toMatchObject({
      badge: 'New sticker',
      title: 'Vaishali earned the Lion sticker 🦁',
      stickerKey: 'lion',
    });
    expect(cardText({ kind: 'sticker', stickerKey: 'okapi', shiny: false, count: 1 }, 'kg', 'Vaishali')).toMatchObject({
      badge: 'Rare find!',
      title: 'Vaishali earned the Okapi sticker',
    });
    expect(cardText({ kind: 'sticker', stickerKey: 'cat', shiny: true, count: 2 }, 'kg', 'Vaishali')).toMatchObject({
      badge: 'Shiny!',
      title: 'Vaishali earned a shiny Cat sticker ✨',
      shiny: true,
    });
  });
  it('a PR card with one PR', () => {
    const t = cardText(
      { kind: 'pr', logId: LOG, workoutName: 'Push', finishedAt: null, prs: [{ exerciseName: 'Bench', prKind: 'reps_at_weight', valueKg: 27.216, reps: 8 }] },
      'lb',
      'Vaishali Kapoor',
    );
    expect(t).toEqual({ badge: null, title: 'Vaishali set a new PR: Bench 60 lb × 8', lines: ['Push'], stickerKey: null, shiny: false });
  });
  it('a PR card with several PRs leads with the first and lists the rest below', () => {
    const t = cardText(
      {
        kind: 'pr',
        logId: LOG,
        workoutName: 'Push',
        finishedAt: null,
        prs: [
          { exerciseName: 'Bench', prKind: 'reps_at_weight', valueKg: 27.216, reps: 8 },
          { exerciseName: 'Dip', prKind: 'heaviest', valueKg: 20, reps: null },
          { exerciseName: 'Deadlift', prKind: 'e1rm', valueKg: 140, reps: null },
        ],
      },
      'lb',
      'Vaishali',
    );
    expect(t.title).toBe('Vaishali set 3 new PRs: Bench 60 lb × 8 and 2 more');
    expect(t.lines).toEqual(['Dip · 44 lb (heaviest)', 'Deadlift · 309 lb (best estimated max)', 'Push']);
    const e1rm = cardText({ kind: 'pr', logId: LOG, workoutName: 'Pull', finishedAt: null, prs: [{ exerciseName: 'Deadlift', prKind: 'e1rm', valueKg: 140, reps: null }] }, 'kg', 'Sam');
    expect(e1rm.title).toBe('Sam set a new PR: Deadlift 140 kg estimated max');
  });
});

describe('stored workout cards', () => {
  it('read with or without volumeKg', () => {
    const { volumeKg: _drop, ...old } = workout();
    void _drop;
    expect(parseCard(old)).not.toBeNull();
    expect(parseCard({ ...old, volumeKg: null })).not.toBeNull();
    expect(parseCard(workout())).toMatchObject({ volumeKg: 698.53 });
    expect(parseCard({ ...old, volumeKg: -1 })).toBeNull();
  });
});

describe('number formatting the sentences use', () => {
  it('groups thousands without touching decimals', () => {
    expect(groupThousands('1540')).toBe('1,540');
    expect(groupThousands('1234567.5')).toBe('1,234,567.5');
    expect(groupThousands('999')).toBe('999');
  });
  it('formatWeight groups thousands too', () => {
    expect(formatWeight(500, 'kg')).toBe('500 kg');
    expect(formatWeight(1000, 'kg')).toBe('1,000 kg');
    expect(formatWeight(1000, 'lb')).toBe('2,205 lb');
  });
  it('a total is a whole number, and the summary volume line says the same', () => {
    expect(formatTotalWeight(698.53, 'lb')).toBe('1,540 lb');
    expect(formatTotalWeight(698.53, 'kg')).toBe('699 kg');
    expect(formatLogVolume(698.53, 'lb')).toBe('1,540 lb lifted');
  });
  it('formatMultiple keeps its wording', () => {
    expect(formatMultiple(1, 'Cow')).toBe('≈ 1 Cow');
    expect(formatMultiple(1.4, 'Hippo')).toBe('≈ 1.4 Hippos');
    expect(formatMultiple(1500, 'Rabbit')).toBe('≈ 1,500 Rabbits');
    expect(formatMultiple(0.02, 'Horse')).toBe('< 0.1 Horses');
  });
});
