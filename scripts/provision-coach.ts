import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { FirstName, LastName, NAME_MAX_LENGTH, type Database } from '@caltracker/shared';

type Admin = SupabaseClient<Database>;

export interface ProvisionInput {
  email: string;
  firstName: string;
  /** Optional: some people use one name. */
  lastName?: string;
  workspaceName: string;
}

export interface ProvisionResult {
  userId: string;
  workspaceId: string;
  created: boolean;
  /** True when an existing owner had never signed in, so a fresh set-password email was sent. */
  resent?: boolean;
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
    if (owner) {
      const base = { userId: owner.user_id, workspaceId: owner.workspace_id, created: false };
      // The first invite link may have expired or been used up by a link scanner. If this coach has
      // never signed in, send a fresh set-password (recovery) email through Supabase Auth.
      const { data: found, error: getError } = await admin.auth.admin.getUserById(owner.user_id);
      if (getError) throw getError;
      if (found.user.last_sign_in_at) return base;
      const { error: resetError } = await admin.auth.resetPasswordForEmail(email, {
        redirectTo: `${requireEnv('PUBLIC_SITE_URL')}/set-password`,
      });
      if (resetError) throw resetError;
      return { ...base, resent: true };
    }
    const other = existing[0]!;
    throw new Error(`User is a ${other.role} of another workspace`);
  }

  // No memberships: either a brand-new email or a user invited earlier whose
  // workspace insert failed.
  let userId: string;
  const invite = await admin.auth.admin.inviteUserByEmail(email, {
    data: { first_name: input.firstName.trim(), last_name: (input.lastName ?? '').trim() },
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

const USAGE =
  'Usage: provision:coach --email <email> --first-name "<first name>" [--last-name "<last name>"] --workspace "<workspace name>"';

/** Reads the command-line options. Throws the usage text when a required option is missing. */
export function parseProvisionArgs(args: string[]): Required<ProvisionInput> {
  const { values } = parseArgs({
    args,
    options: {
      email: { type: 'string' },
      'first-name': { type: 'string' },
      'last-name': { type: 'string' },
      workspace: { type: 'string' },
    },
  });
  const email = values.email?.trim();
  const workspaceName = values.workspace?.trim();
  if (!email || !values['first-name']?.trim() || !workspaceName) throw new Error(USAGE);
  const firstName = FirstName.safeParse(values['first-name']);
  const lastName = LastName.safeParse(values['last-name'] ?? '');
  if (!firstName.success || !lastName.success) {
    throw new Error(`First and last name can be at most ${NAME_MAX_LENGTH} characters each.`);
  }
  return { email, firstName: firstName.data, lastName: lastName.data, workspaceName };
}

async function main(): Promise<void> {
  const input = parseProvisionArgs(process.argv.slice(2));
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  requireEnv('PUBLIC_SITE_URL');

  const admin = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const r = await provisionCoach(admin, input);
  console.log(`User id:      ${r.userId}`);
  console.log(`Workspace id: ${r.workspaceId}`);
  if (r.resent) {
    console.log('Nothing created: this coach already exists but has never signed in. A new set-password email was sent.');
  } else if (r.created) {
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
