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
    const r = await provisionCoach(admin, { email, fullName: 'Test Coach', workspaceName: 'Test Gym' });
    userIds.push(r.userId);
    workspaceIds.push(r.workspaceId);
    expect(r.created).toBe(true);
    expect(await members(r.userId)).toEqual([{ workspace_id: r.workspaceId, role: 'owner' }]);
    const { data: ws } = await admin.from('workspaces').select('name').eq('id', r.workspaceId).single();
    expect(ws?.name).toBe('Test Gym');
    const { data: p } = await admin.from('profiles').select('full_name').eq('id', r.userId).single();
    expect(p?.full_name).toBe('Test Coach');
  });

  it('is idempotent and ignores a different workspace name', async () => {
    const email = uniqueEmail();
    const a = await provisionCoach(admin, { email, fullName: 'C', workspaceName: 'One' });
    userIds.push(a.userId);
    workspaceIds.push(a.workspaceId);
    const b = await provisionCoach(admin, { email: email.toUpperCase(), fullName: 'C', workspaceName: 'Two' });
    expect(b).toEqual({ userId: a.userId, workspaceId: a.workspaceId, created: false });
    expect(await members(a.userId)).toHaveLength(1);
    const { data: ws } = await admin.from('workspaces').select('name').eq('id', a.workspaceId).single();
    expect(ws?.name).toBe('One');
  });

  it('provisions an existing user who has no memberships', async () => {
    const email = uniqueEmail();
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    expect(error).toBeNull();
    userIds.push(data.user!.id);
    const r = await provisionCoach(admin, { email, fullName: 'C', workspaceName: 'Late' });
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
      provisionCoach(admin, { email, fullName: 'C', workspaceName: 'Mine' }),
    ).rejects.toThrow('User is a client of another workspace');
  });
});
