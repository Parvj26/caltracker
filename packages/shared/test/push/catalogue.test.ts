import { describe, expect, it } from 'vitest';
import { PUSH_GROUP_TITLES, PUSH_TYPES, notificationCatalogue } from '../../src/push/catalogue';

describe('notificationCatalogue', () => {
  it('has the 11 keys, all on by default', () => {
    expect(PUSH_TYPES).toHaveLength(11);
    expect(PUSH_TYPES.every((t) => notificationCatalogue[t].defaultOn)).toBe(true);
    expect(Object.keys(notificationCatalogue).sort()).toEqual([...PUSH_TYPES].sort());
  });

  it('keeps the agreed order', () => {
    expect(PUSH_TYPES).toEqual([
      'workout_assigned',
      'workout_changed',
      'daily_reminder',
      'coach_logged',
      'still_training',
      'message',
      'workout_comment',
      'meal_comment',
      'food_targets',
      'community_coach_post',
      'community_activity',
    ]);
  });

  it('hides meal comments until they exist', () => {
    expect(notificationCatalogue.meal_comment.available).toBe(false);
    expect(PUSH_TYPES.filter((t) => !notificationCatalogue[t].available)).toEqual(['meal_comment']);
  });

  it('uses the approved labels and groups', () => {
    expect(notificationCatalogue.workout_changed).toMatchObject({
      group: 'workouts',
      label: 'Today’s workout changed',
      hint: 'When your coach edits today’s plan',
    });
    expect(notificationCatalogue.message).toMatchObject({ group: 'coach', label: 'Messages', hint: 'New message from your coach' });
    expect(notificationCatalogue.community_activity).toMatchObject({
      group: 'community',
      label: 'Reactions and comments',
      hint: 'Grouped, e.g. “Sam and 4 others”',
    });
    expect(PUSH_GROUP_TITLES).toEqual({ workouts: 'Workouts', coach: 'Your coach', community: 'Community' });
  });
});
