import { describe, expect, it } from 'vitest';
import { deletedMessage, libraryLine } from './admin-coach';

describe('libraryLine', () => {
  it('counts programs, workouts and shared meals with plurals', () => {
    expect(libraryLine({ clients: 1, staff: 0, programs: 1, workouts: 1, shared_meals: 0, custom_exercises: 2 })).toBe(
      '1 program, 1 workout, 0 shared meals',
    );
    expect(libraryLine({ clients: 0, staff: 0, programs: 3, workouts: 2, shared_meals: 1, custom_exercises: 0 })).toBe(
      '3 programs, 2 workouts, 1 shared meal',
    );
  });
});

describe('deletedMessage', () => {
  it('says what was deleted and who was emailed', () => {
    expect(deletedMessage({ workspaceName: 'Luis Gym', clientsEmailed: 1, emailsFailed: 0, accountsNotDeleted: 0 })).toBe(
      'Luis Gym deleted · 1 client emailed',
    );
    expect(deletedMessage({ workspaceName: 'Empty', clientsEmailed: 0, emailsFailed: 0, accountsNotDeleted: 0 })).toBe('Empty deleted');
  });

  it('points out failed emails and accounts that are left', () => {
    expect(deletedMessage({ workspaceName: 'W', clientsEmailed: 2, emailsFailed: 1, accountsNotDeleted: 1 })).toBe(
      "W deleted · 2 clients emailed · 1 email couldn't be sent (see the function logs) · 1 coach account couldn't be removed: ask a developer",
    );
  });
});
