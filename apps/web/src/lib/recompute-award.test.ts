import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { recomputeAward } from './recompute-award';

const LOG = '00000000-0000-4000-8000-000000000001';
const clientWith = (invoke: (name: string, opts: unknown) => Promise<unknown>) =>
  ({ functions: { invoke } }) as unknown as SupabaseClient<Database>;

afterEach(() => vi.restoreAllMocks());

describe('recomputeAward', () => {
  it('asks award-workout for a recompute of that log', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: {}, error: null });
    await recomputeAward(clientWith(invoke), LOG);
    expect(invoke).toHaveBeenCalledWith('award-workout', { body: { logId: LOG, recompute: true } });
  });

  it('stays quiet for a removed client (403 not_a_client)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const context = new Response(JSON.stringify({ hint: 'not_a_client' }), { status: 403 });
    await recomputeAward(clientWith(() => Promise.resolve({ error: { message: 'x', context } })), LOG);
    expect(spy).not.toHaveBeenCalled();
  });

  it('logs but never throws on any other failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await recomputeAward(clientWith(() => Promise.resolve({ error: { message: 'boom' } })), LOG);
    await recomputeAward(clientWith(() => Promise.reject(new Error('network'))), LOG);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
