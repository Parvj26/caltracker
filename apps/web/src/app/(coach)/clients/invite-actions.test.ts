import { beforeEach, describe, expect, it, vi } from 'vitest';

// A pending invite's window: rename (rename_invite), change plan (set_invite_plan) and change email (a new invite
// through send-invite, the old plan kept, then the old invite cancelled).

const INVITE = '00000000-0000-4000-8000-000000000011';
const NEW_INVITE = '00000000-0000-4000-8000-000000000012';
const PROGRAM = '00000000-0000-4000-8000-000000000013';
type Rpc = { name: string; payload: Record<string, unknown> };
const rpcs: Rpc[] = [];
const deletes: string[] = [];
const sends: unknown[] = [];
let rpcError: { code: string } | null = null;
let sendStatus = 'sent';

const OLD = {
  id: INVITE,
  email: 'ana@old.test',
  first_name: 'Ana',
  last_name: 'Torres',
  client_invite_plan_items: [{ program_id: PROGRAM, workout_id: null, start_on: '2026-11-10', position: 0 }],
};

function query(table: string) {
  let deleting = false;
  let byEmail = false;
  const builder = {
    select: () => builder,
    delete: () => ((deleting = true), builder),
    eq: (col: string, v: string) => {
      if (col === 'email') byEmail = true;
      if (deleting && col === 'id') deletes.push(v);
      return builder;
    },
    is: () => builder,
    maybeSingle: () =>
      Promise.resolve(table === 'client_invites' && byEmail ? { data: { id: NEW_INVITE, expires_at: 'x' }, error: null } : { data: OLD, error: null }),
    then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
  };
  return builder;
}
const supabase = {
  from: query,
  rpc: (name: string, payload: Record<string, unknown>) => {
    rpcs.push({ name, payload });
    return Promise.resolve({ data: 1, error: rpcError });
  },
  functions: {
    invoke: (_name: string, { body }: { body: { invites: { email: string }[] } }) => {
      sends.push(body);
      return Promise.resolve({ data: { results: body.invites.map((i) => ({ email: i.email, status: sendStatus })) }, error: null });
    },
  },
};

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth', () => ({ requireCoach: () => Promise.resolve({ workspaceId: '00000000-0000-4000-8000-000000000001' }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve(supabase) }));

import { changeInviteEmail, renameInvite, updateInvitePlan } from './actions';

beforeEach(() => {
  rpcs.length = 0;
  deletes.length = 0;
  sends.length = 0;
  rpcError = null;
  sendStatus = 'sent';
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
});

describe('renameInvite', () => {
  it('splits the one Name field into first and last name', async () => {
    expect(await renameInvite(INVITE, '  Ana Maria  Torres ')).toEqual({ ok: true });
    expect(rpcs[0]).toEqual({ name: 'rename_invite', payload: { p_invite_id: INVITE, p_first_name: 'Ana', p_last_name: 'Maria  Torres' } });
  });
  it('refuses a blank name and an accepted invite', async () => {
    expect(await renameInvite(INVITE, '  ')).toMatchObject({ ok: false, code: 'invite_first_name_invalid' });
    rpcError = { code: '55000' };
    expect(await renameInvite(INVITE, 'Ana')).toMatchObject({ ok: false, code: 'invite_already_used' });
  });
});

describe('updateInvitePlan', () => {
  it('keeps the new plan with the invite', async () => {
    expect(await updateInvitePlan({ inviteId: INVITE, plan: { kind: 'program', programId: PROGRAM, startOn: '2026-11-23' }, today: '2026-11-20' })).toEqual({ ok: true });
    expect(rpcs[0]).toEqual({ name: 'set_invite_plan', payload: { p_invite_id: INVITE, p_program_id: PROGRAM, p_start_on: '2026-11-23' } });
  });
  it('refuses a day in the past', async () => {
    expect(await updateInvitePlan({ inviteId: INVITE, plan: { kind: 'program', programId: PROGRAM, startOn: '2026-11-19' }, today: '2026-11-20' })).toMatchObject({ ok: false });
    expect(rpcs).toHaveLength(0);
  });
});

describe('changeInviteEmail', () => {
  it('invites the new email with the same name, keeps the plan (from today on), then cancels the old invite', async () => {
    expect(await changeInviteEmail({ inviteId: INVITE, email: 'ANA@new.test', today: '2026-11-20' })).toMatchObject({ ok: true, inviteId: NEW_INVITE, planError: null });
    expect(sends[0]).toMatchObject({ invites: [{ email: 'ana@new.test', firstName: 'Ana', lastName: 'Torres' }] });
    expect(rpcs[0]).toEqual({ name: 'set_invite_plan', payload: { p_invite_id: NEW_INVITE, p_program_id: PROGRAM, p_start_on: '2026-11-20' } });
    expect(deletes).toEqual([INVITE]);
  });
  it('changes nothing when the new invite is not sent', async () => {
    sendStatus = 'already_member';
    expect(await changeInviteEmail({ inviteId: INVITE, email: 'ana@new.test', today: '2026-11-20' })).toMatchObject({ ok: true, inviteId: null });
    expect(deletes).toEqual([]);
    expect(rpcs).toHaveLength(0);
  });
  it('refuses the same email or a bad one', async () => {
    expect(await changeInviteEmail({ inviteId: INVITE, email: 'Ana@Old.test', today: '2026-11-20' })).toMatchObject({ ok: false, code: 'invite_email_same' });
    expect(await changeInviteEmail({ inviteId: INVITE, email: 'nope', today: '2026-11-20' })).toMatchObject({ ok: false, code: 'invite_email_invalid' });
    expect(sends).toHaveLength(0);
  });
});
