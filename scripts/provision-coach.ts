import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';

type Admin = SupabaseClient<Database>;

export interface ProvisionInput {
  email: string;
  fullName: string;
  workspaceName: string;
}

export interface ProvisionResult {
  userId: string;
  workspaceId: string;
  created: boolean;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Finds an auth user id by email without memberships (rare fallback path). */
async function findUserIdByEmail(admin: Admin, email: string): Promise<string | undefined> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return undefined;
  }
}

async function createWorkspaceWithOwner(
  admin: Admin,
  userId: string,
  workspaceName: string,
): Promise<string> {
  const { data: ws, error } = await admin
    .from('workspaces')
    .insert({ name: workspaceName })
    .select('id')
    .single();
  if (error) throw error;
  const { error: memberError } = await admin
    .from('workspace_members')
    .insert({ workspace_id: ws.id, user_id: userId, role: 'owner' });
  if (memberError) {
    // Roll back so a retry starts clean.
    await admin.from('workspaces').delete().eq('id', ws.id);
    throw memberError;
  }
  return ws.id;
}

export async function provisionCoach(
  admin: Admin,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const email = input.email.trim().toLowerCase();

  const { data: existing, error: lookupError } = await admin.rpc('lookup_members_by_email', {
    emails: [email],
  });
  if (lookupError) throw lookupError;

  if (existing.length > 0) {
    const owner = existing.find((m) => m.role === 'owner');
    if (owner) return { userId: owner.user_id, workspaceId: owner.workspace_id, created: false };
    const other = existing[0]!;
    throw new Error(`User is a ${other.role} of another workspace`);
  }

  // No memberships: either a brand-new email or a user invited earlier whose
  // workspace insert failed.
  let userId: string;
  const invite = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: input.fullName },
    redirectTo: `${requireEnv('PUBLIC_SITE_URL')}/set-password`,
  });
  if (invite.error) {
    if (invite.error.code !== 'email_exists') throw invite.error;
    const found = await findUserIdByEmail(admin, email);
    if (!found) throw invite.error;
    userId = found;
  } else {
    userId = invite.data.user.id;
  }

  const workspaceId = await createWorkspaceWithOwner(admin, userId, input.workspaceName);
  return { userId, workspaceId, created: true };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      workspace: { type: 'string' },
    },
  });
  if (!values.email || !values.name || !values.workspace) {
    throw new Error('Usage: provision:coach --email <email> --name "<full name>" --workspace "<workspace name>"');
  }
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  requireEnv('PUBLIC_SITE_URL');

  const admin = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const r = await provisionCoach(admin, {
    email: values.email,
    fullName: values.name,
    workspaceName: values.workspace,
  });
  console.log(`User id:      ${r.userId}`);
  console.log(`Workspace id: ${r.workspaceId}`);
  if (r.created) {
    console.log('Created: workspace and owner membership (invite email sent if the user was new).');
  } else {
    console.log('Nothing created: this user already owns a workspace. Existing workspace returned unchanged (--workspace ignored).');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
