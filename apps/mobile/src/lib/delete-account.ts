import { FunctionsHttpError } from '@supabase/supabase-js';
import { coachFirstName } from './coach-tab';

// Settings -> Delete account (the approved account-canvas Delete and Deleted boards). Pure copy and the call to the
// delete-account Edge Function, unit tested; the screens are delete-account.tsx and account-deleted.tsx.

export const DELETE_WORD = 'DELETE';

/** The button turns on once the client types DELETE (spaces around it are ignored). */
export const canConfirmDelete = (typed: string) => typed.trim() === DELETE_WORD;

export const DELETE_LIST = [
  'Workouts, sets and personal bests',
  'Meals and food targets',
  'Body scans and goals',
  'Messages and photos you sent',
  'Community posts, comments and stickers',
] as const;

/** "Luis will no longer see your history. This can’t be undone." */
export function historyWarning(coachName: string | null | undefined): string {
  return `${coachFirstName(coachName) ?? 'Your coach'} will no longer see your history. This can’t be undone.`;
}

export const DELETE_FAILED = 'Something went wrong. Try again.';

export type DeleteResult =
  | { status: 'deleted' }
  /** A coach signed in on the phone: their account is closed by email (the server's message says how). */
  | { status: 'coach_account'; message: string }
  | { status: 'retry'; message: string };

export type DeleteClient = {
  functions: { invoke: (name: string, options?: { method?: 'POST' }) => Promise<{ data: unknown; error: unknown }> };
};

async function bodyOf(error: FunctionsHttpError): Promise<unknown> {
  try {
    return await (error.context as Response).json();
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Deletes the signed-in client's account. Never throws: anything but a clear answer is "try again". */
export async function deleteMyAccount(client: DeleteClient): Promise<DeleteResult> {
  const retry: DeleteResult = { status: 'retry', message: DELETE_FAILED };
  try {
    const { data, error } = await client.functions.invoke('delete-account', { method: 'POST' });
    if (error instanceof FunctionsHttpError) {
      const body = await bodyOf(error);
      if (isRecord(body) && body.error === 'coach_account' && typeof body.message === 'string') {
        return { status: 'coach_account', message: body.message };
      }
      return retry;
    }
    if (error) return retry;
    return isRecord(data) && data.deleted === true ? { status: 'deleted' } : retry;
  } catch {
    return retry;
  }
}
