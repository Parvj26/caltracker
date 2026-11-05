import { z } from 'zod';
import { IsoDateSchema } from '../dates/dates';

export const PROGRAM_WEEKS_MAX = 52;
const WEEKS_ERROR = 'Programs are 1 to 52 weeks.';

/** A program's details. Its length changes only through set_program_weeks, which removes slots past the end. */
export const ProgramInput = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Keep the name under 100 characters.'),
  description: z.string().trim().max(2000, 'Keep the description under 2000 characters.').nullable(),
  weeks: z.number({ error: WEEKS_ERROR }).int(WEEKS_ERROR).min(1, WEEKS_ERROR).max(PROGRAM_WEEKS_MAX, WEEKS_ERROR),
});
export type ProgramInput = z.infer<typeof ProgramInput>;

/** assign_program(p_assignment_id, p_program_id, p_client_id, p_start_date). The id is made by the caller, so a retry is a no-op. */
export const AssignProgramInput = z.object({
  assignmentId: z.string().uuid(),
  programId: z.string().uuid(),
  clientId: z.string().uuid(),
  startDate: IsoDateSchema,
  /** The coach's today, from their browser (see date-rules). */
  today: IsoDateSchema,
});
export type AssignProgramInput = z.infer<typeof AssignProgramInput>;

/** schedule_workout(p_new_id, p_workout_id, p_client_id, p_date). The id is made by the caller, so a retry is a no-op. */
export const ScheduleWorkoutInput = z.object({
  newId: z.string().uuid(),
  workoutId: z.string().uuid(),
  clientId: z.string().uuid(),
  date: IsoDateSchema,
  /** The coach's today, from their browser (see date-rules). */
  today: IsoDateSchema,
});
export type ScheduleWorkoutInput = z.infer<typeof ScheduleWorkoutInput>;
