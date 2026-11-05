import { describe, expect, it } from 'vitest';
import { AssignProgramInput, ProgramInput, ScheduleWorkoutInput } from '../../src/programs/schema';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const C = '00000000-0000-4000-8000-000000000003';

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues.map((i) => i.message) ?? [];

describe('ProgramInput', () => {
  it('accepts a named program, trims the name and keeps a null description', () => {
    expect(ProgramInput.parse({ name: '  Strength  ', description: null, weeks: 4 })).toEqual({
      name: 'Strength',
      description: null,
      weeks: 4,
    });
  });

  it.each([0, 53])('rejects %i weeks', (weeks) => {
    const r = ProgramInput.safeParse({ name: 'Strength', description: null, weeks });
    expect(r.success).toBe(false);
    expect(messages(r)).toEqual(['Programs are 1 to 52 weeks.']);
  });

  it('rejects a fractional number of weeks', () => {
    const r = ProgramInput.safeParse({ name: 'Strength', description: null, weeks: 1.5 });
    expect(messages(r)).toEqual(['Programs are 1 to 52 weeks.']);
  });

  it('accepts 1 and 52 weeks', () => {
    expect(ProgramInput.safeParse({ name: 'S', description: null, weeks: 1 }).success).toBe(true);
    expect(ProgramInput.safeParse({ name: 'S', description: null, weeks: 52 }).success).toBe(true);
  });

  it('asks for a name when it is blank', () => {
    const r = ProgramInput.safeParse({ name: '   ', description: null, weeks: 4 });
    expect(messages(r)).toEqual(['Enter a name.']);
  });

  it('rejects a name over 100 characters and a description over 2000', () => {
    expect(ProgramInput.safeParse({ name: 'x'.repeat(101), description: null, weeks: 4 }).success).toBe(false);
    expect(ProgramInput.safeParse({ name: 'S', description: 'x'.repeat(2001), weeks: 4 }).success).toBe(false);
    expect(ProgramInput.safeParse({ name: 'S', description: 'x'.repeat(2000), weeks: 4 }).success).toBe(true);
  });
});

describe('AssignProgramInput', () => {
  const valid = { assignmentId: A, programId: B, clientId: C, startDate: '2026-03-02' };

  it('accepts uuids and a real date', () => {
    expect(AssignProgramInput.parse(valid)).toEqual(valid);
  });

  it('rejects a date that does not exist', () => {
    const r = AssignProgramInput.safeParse({ ...valid, startDate: '2026-02-30' });
    expect(r.success).toBe(false);
    expect(messages(r)).toEqual(['That date does not exist.']);
  });

  it.each(['assignmentId', 'programId', 'clientId'] as const)('rejects a non-uuid %s', (key) => {
    expect(AssignProgramInput.safeParse({ ...valid, [key]: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('ScheduleWorkoutInput', () => {
  const valid = { newId: A, workoutId: B, clientId: C, date: '2026-12-31' };

  it('accepts uuids and a real date', () => {
    expect(ScheduleWorkoutInput.parse(valid)).toEqual(valid);
  });

  it('rejects a date that does not exist or is badly formatted', () => {
    expect(ScheduleWorkoutInput.safeParse({ ...valid, date: '2026-02-29' }).success).toBe(false);
    expect(ScheduleWorkoutInput.safeParse({ ...valid, date: '31/12/2026' }).success).toBe(false);
  });

  it.each(['newId', 'workoutId', 'clientId'] as const)('rejects a non-uuid %s', (key) => {
    expect(ScheduleWorkoutInput.safeParse({ ...valid, [key]: '123' }).success).toBe(false);
  });
});
