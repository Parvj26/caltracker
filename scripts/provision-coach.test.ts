import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { provisionCoach } from './provision-coach';

const admin = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const userIds: string[] = [];
const workspaceIds: string[] = [];
const uniqueEmail = () => `coach-${randomUUID()}@example.test`;

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  for (const id of workspaceIds) await admin.from('workspaces').delete().eq('id', id);
});

async function mailSubjectsTo(email: string): Promise<string[]> {
  const q = encodeURIComponent(`to:"${email}"`);
  const res = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${q}`);
  const body = (await res.json()) as { messages: { Subject: string; To: { Address: string }[] }[] };
  return body.messages.filter((m) => m.To.some((t) => t.Address.toLowerCase() === email)).map((m) => m.Subject);
}

// Delivery to Mailpit is asynchronous (slower right after a cold start, as in CI): poll briefly.
async function waitForSubjects(email: string, match: string, count: number, timeoutMs = 10_000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await mailSubjectsTo(email)).filter((s) => s.includes(match));
    if (found.length >= count || Date.now() > deadline) return found;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function members(userId: string) {
  const { data, error } = await admin
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', userId);
  expect(error).toBeNull();
  return data ?? [];
}

describe('provisionCoach', () => {
  it('creates user, workspace and owner membership for a new email', async () => {
    const email = uniqueEmail();
    const r = await provisionCoach(admin, { email, firstName: ' Test ', lastName: ' Coach ', workspaceName: 'Test Gym' });
    userIds.push(r.userId);
    workspaceIds.push(r.workspaceId);
    expect(r.created).toBe(true);
    expect(await members(r.userId)).toEqual([{ workspace_id: r.workspaceId, role: 'owner' }]);
    const { data: ws } = await admin.from('workspaces').select('name').eq('id', r.workspaceId).single();
    expect(ws?.name).toBe('Test Gym');
    const { data: p } = await admin.from('profiles').select('first_name, last_name, full_name').eq('id', r.userId).single();
    expect(p).toEqual({ first_name: 'Test', last_name: 'Coach', full_name: 'Test Coach' });
  });

  it('is idempotent and ignores a different workspace name', async () => {
    const email = uniqueEmail();
    const a = await provisionCoach(admin, { email, firstName: 'C', workspaceName: 'One' });
    userIds.push(a.userId);
    workspaceIds.push(a.workspaceId);
    const b = await provisionCoach(admin, { email: email.toUpperCase(), firstName: 'C', workspaceName: 'Two' });
    // Never signed in, so the repeat run re-sends the set-password email (see the test below).
    expect(b).toEqual({ userId: a.userId, workspaceId: a.workspaceId, created: false, resent: true });
    expect(await members(a.userId)).toHaveLength(1);
    const { data: ws } = await admin.from('workspaces').select('name').eq('id', a.workspaceId).single();
    expect(ws?.name).toBe('One');
  });

  it('re-sends a set-password email to an owner who never signed in, and not to one who has', async () => {
    const email = uniqueEmail();
    const a = await provisionCoach(admin, { email, firstName: 'C', workspaceName: 'Resend Gym' });
    userIds.push(a.userId);
    workspaceIds.push(a.workspaceId);
    expect(a.resent).toBeUndefined();

    // GoTrue allows one email per address per second.
    await new Promise((r) => setTimeout(r, 1500));
    const again = await provisionCoach(admin, { email, firstName: 'C', workspaceName: 'Resend Gym' });
    expect(again).toEqual({ userId: a.userId, workspaceId: a.workspaceId, created: false, resent: true });
    expect(await waitForSubjects(email, 'Reset your CalTracker password', 1)).toHaveLength(1);

    // Once they have signed in there is nothing to re-send.
    const password = 'some-password-123';
    await admin.auth.admin.updateUserById(a.userId, { password, email_confirm: true });
    const anon = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
    const third = await provisionCoach(admin, { email, firstName: 'C', workspaceName: 'Resend Gym' });
    expect(third).toEqual({ userId: a.userId, workspaceId: a.workspaceId, created: false });
  });

  it('provisions an existing user who has no memberships', async () => {
    const email = uniqueEmail();
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    expect(error).toBeNull();
    userIds.push(data.user!.id);
    const r = await provisionCoach(admin, { email, firstName: 'C', workspaceName: 'Late' });
    workspaceIds.push(r.workspaceId);
    expect(r.userId).toBe(data.user!.id);
    expect(r.created).toBe(true);
    expect(await members(r.userId)).toEqual([{ workspace_id: r.workspaceId, role: 'owner' }]);
  });

  it('refuses an existing client', async () => {
    const email = uniqueEmail();
    const { data } = await admin.auth.admin.createUser({ email, email_confirm: true });
    userIds.push(data.user!.id);
    const { data: ws } = await admin.from('workspaces').insert({ name: 'Other' }).select('id').single();
    workspaceIds.push(ws!.id);
    await admin.from('workspace_members').insert({ workspace_id: ws!.id, user_id: data.user!.id, role: 'client' });
    await expect(
      provisionCoach(admin, { email, firstName: 'C', workspaceName: 'Mine' }),
    ).rejects.toThrow('User is a client of another workspace');
  });
});
