import { describe, expect, it } from 'vitest';
import type { MealMacros } from '@caltracker/shared';
import {
  agoText,
  communityHeadline,
  foodCard,
  newCountLabel,
  nextSteps,
  nextUpDay,
  programChip,
  weekTally,
  weekTile,
  welcome,
  workoutMeta,
} from './today-logic';

const macros = (calories: number | null, protein: number | null): MealMacros => ({ calories, protein, carbs: null, fat: null });

describe('welcome', () => {
  it('welcomes by first name, or plainly while it isn’t known', () => {
    expect(welcome('Parv Jain')).toBe('Welcome, Parv');
    expect(welcome(null)).toBe('Welcome');
    expect(welcome('  ')).toBe('Welcome');
  });
});

describe('workout card', () => {
  it('reads count, time and up to three muscle groups', () => {
    expect(workoutMeta(6, 50, ['Chest', 'Back', 'Shoulders', 'Arms'])).toBe('6 exercises · about 50 min · Chest, Back, Shoulders');
    expect(workoutMeta(1, 10, [])).toBe('1 exercise · about 10 min');
  });

  it('shows only the count until the plan is loaded', () => {
    expect(workoutMeta(4, null, [])).toBe('4 exercises');
  });

  it('labels a program day, and nothing for a one-off workout', () => {
    expect(programChip({ week: 2, day: 1 })).toBe('Week 2 · Day 1');
    expect(programChip(null)).toBeNull();
  });
});

describe('rest day', () => {
  it('names the next workout’s weekday within the coming week', () => {
    expect(nextUpDay('2026-11-11', '2026-11-10')).toBe('Wednesday');
    expect(nextUpDay('2026-11-16', '2026-11-10')).toBe('Monday');
  });

  it('uses the date further out', () => {
    expect(nextUpDay('2026-11-17', '2026-11-10')).toBe('Tue 17 Nov');
  });
});

describe('food card', () => {
  const targets = { calories: 2100, protein: 170, carbs: null, fat: null };

  it('shows calories and protein against the targets, with bars', () => {
    const c = foodCard(
      [
        { name: 'Breakfast', macros: macros(540, 40) },
        { name: 'Lunch', macros: macros(700, 56) },
      ],
      targets,
    );
    expect(c.calories).toEqual({ value: '1,240 / 2,100', fraction: 1240 / 2100, label: 'Calories 1,240 of 2,100 kcal' });
    expect(c.protein).toEqual({ value: '96 / 170 g', fraction: 96 / 170, label: 'Protein 96 of 170 g' });
    expect(c.meals).toBe('2 meals logged · Breakfast, Lunch');
  });

  it('caps a bar at full and leaves it out without a target', () => {
    const c = foodCard([{ name: null, macros: macros(2500, 20) }], { calories: 2000, protein: null, carbs: null, fat: null });
    expect(c.calories.fraction).toBe(1);
    expect(c.protein).toEqual({ value: '20 g', fraction: null, label: 'Protein 20 g' });
    expect(c.meals).toBe('1 meal logged · Meal');
  });

  it('says when nothing is logged yet, and names each meal once', () => {
    expect(foodCard([], null).meals).toBe('No meals logged yet');
    expect(foodCard([], null).calories).toEqual({ value: '0 kcal', fraction: null, label: 'Calories 0 kcal' });
    expect(
      foodCard(
        [
          { name: 'Snack', macros: macros(100, 1) },
          { name: ' snack ', macros: macros(100, 1) },
          { name: 'Dinner', macros: macros(100, 1) },
        ],
        null,
      ).meals,
    ).toBe('3 meals logged · Snack, Dinner');
  });
});

describe('coach message time', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  it('says how long ago in short words', () => {
    expect(agoText('2026-11-09T11:59:30Z', now)).toBe('just now');
    expect(agoText('2026-11-09T11:55:00Z', now)).toBe('5 min ago');
    expect(agoText('2026-11-09T10:00:00Z', now)).toBe('2 h ago');
    expect(agoText('2026-11-06T12:00:00Z', now)).toBe('3 d ago');
    expect(agoText('2026-10-20T12:00:00Z', now)).toBe('2 wk ago');
  });
});

describe('this week', () => {
  it('counts the week’s planned workouts that are done', () => {
    expect(
      weekTally(['a', 'b', 'c', 'd'], {
        a: { kind: 'done', logId: 'l1', durationS: 60 },
        b: { kind: 'in_progress', logId: 'l2' },
        x: { kind: 'done', logId: 'l3', durationS: 60 },
      }),
    ).toEqual({ done: 1, planned: 4 });
  });

  it('reads done of planned and the streak', () => {
    expect(weekTile({ done: 1, planned: 4 }, 5)).toEqual({ big: '1 of 4', small: 'workouts · 5-wk streak' });
    expect(weekTile({ done: 0, planned: 1 }, 0)).toEqual({ big: '0 of 1', small: 'workout' });
  });

  it('has a plain line for a week with nothing planned', () => {
    expect(weekTile({ done: 0, planned: 0 }, 0)).toEqual({ big: 'None planned', small: 'this week' });
    expect(weekTile({ done: 0, planned: 0 }, 3)).toEqual({ big: 'None planned', small: '3-wk streak' });
  });
});

describe('community peek', () => {
  it('keeps a sentence that already names the poster', () => {
    expect(communityHeadline({ author: 'Sam', snippet: 'Sam set 2 new PRs 🏆' })).toBe('Sam set 2 new PRs 🏆');
    expect(communityHeadline({ author: 'You', snippet: 'You earned the Corgi sticker' })).toBe('You earned the Corgi sticker');
  });

  it('puts the first name before a plain post', () => {
    expect(communityHeadline({ author: 'Sam Lee', snippet: 'Morning lift done' })).toBe('Sam: Morning lift done');
    expect(communityHeadline({ author: 'Luis Bueno · Coach', snippet: 'Happy Diwali' })).toBe('Luis: Happy Diwali');
    expect(communityHeadline({ author: 'Sam Lee', snippet: 'Shared a photo' })).toBe('Sam shared a photo');
    expect(communityHeadline({ author: 'Sam Lee', snippet: '' })).toBe('Sam posted');
  });

  it('counts what is new', () => {
    expect(newCountLabel(3)).toBe('3 new');
    expect(newCountLabel(120)).toBe('99+ new');
    expect(newCountLabel(0)).toBeNull();
  });
});

describe('new client', () => {
  it('explains what happens next, naming the coach', () => {
    expect(nextSteps('Luis Bueno')).toEqual([
      'Luis builds your plan and it appears here and in Workouts.',
      'Tap Start, log each set, and finish. It takes a few taps.',
      'Earn stickers and watch your progress grow.',
    ]);
    expect(nextSteps(null)[0]).toBe('Your coach builds your plan and it appears here and in Workouts.');
  });
});
