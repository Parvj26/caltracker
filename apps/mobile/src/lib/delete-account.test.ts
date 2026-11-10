import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  DELETE_LIST,
  DELETE_FAILED,
  canConfirmDelete,
  deleteMyAccount,
  historyWarning,
  type DeleteClient,
} from './delete-account';

const client = (result: { data?: unknown; error?: unknown } | Error): DeleteClient => ({
  functions: {
    invoke: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve({ data: result.data ?? null, error: result.error ?? null })),
  },
});
const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('Delete account: the confirmation', () => {
  it('turns the button on only for DELETE, ignoring spaces around it', () => {
    expect(canConfirmDelete('DELE')).toBe(false);
    expect(canConfirmDelete('delete')).toBe(false);
    expect(canConfirmDelete('')).toBe(false);
    expect(canConfirmDelete('DELETE')).toBe(true);
    expect(canConfirmDelete('  DELETE ')).toBe(true);
  });

  it('lists what is erased, as on the board', () => {
    expect(DELETE_LIST).toEqual([
      'Workouts, sets and personal bests',
      'Meals and food targets',
      'Body scans and goals',
      'Messages and photos you sent',
      'Community posts, comments and stickers',
    ]);
  });

  it('names the coach in the warning, or says "Your coach" when the name is unknown', () => {
    expect(historyWarning('Luis Bueno')).toBe('Luis will no longer see your history. This can’t be undone.');
    expect(historyWarning(null)).toBe('Your coach will no longer see your history. This can’t be undone.');
  });
});

describe('deleteMyAccount', () => {
  it('is deleted on 200 { deleted: true }', async () => {
    await expect(deleteMyAccount(client({ data: { deleted: true } }))).resolves.toEqual({ status: 'deleted' });
  });

  it('passes on the coach message on 409', async () => {
    const message = "Coach accounts are closed by email. Write to support@caltracker.app and we'll do it for you.";
    await expect(deleteMyAccount(client({ error: httpError(409, { error: 'coach_account', message }) }))).resolves.toEqual({
      status: 'coach_account',
      message,
    });
  });

  it('asks to try again on a server error, no signal or anything unexpected', async () => {
    const retry = { status: 'retry', message: DELETE_FAILED };
    await expect(deleteMyAccount(client({ error: httpError(500, { error: 'retry' }) }))).resolves.toEqual(retry);
    await expect(deleteMyAccount(client({ error: new FunctionsFetchError('offline') }))).resolves.toEqual(retry);
    await expect(deleteMyAccount(client(new Error('boom')))).resolves.toEqual(retry);
    await expect(deleteMyAccount(client({ data: { something: 'else' } }))).resolves.toEqual(retry);
    expect(DELETE_FAILED).toBe('Something went wrong. Try again.');
  });
});
