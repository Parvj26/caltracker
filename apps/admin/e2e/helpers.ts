import { execFileSync, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { expect, type Page } from '@playwright/test';
import * as OTPAuth from 'otpauth';

export type AdminRole = Database['public']['Enums']['admin_role'];

export const PASSWORD = 'admin-e2e-password-123';

/** The local database container (supabase/config.toml project_id). */
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_fitness-tracker';

function env(name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY'): string {
  const value = process.env[name];
  if (value) return value;
  const out = execSync('supabase status -o env', { encoding: 'utf8' });
  const key = { SUPABASE_URL: 'API_URL', SUPABASE_ANON_KEY: 'ANON_KEY', SUPABASE_SERVICE_ROLE_KEY: 'SERVICE_ROLE_KEY' }[name];
  const found = out.match(new RegExp(`^${key}="?([^"\\n]+)"?$`, 'm'))?.[1];
  if (!found) throw new Error(`Set ${name}, or run local Supabase.`);
  return found;
}

/** Service-role client: test fixtures and cleanup only, never app code. */
export function serviceClient(): SupabaseClient<Database> {
  return createClient<Database>(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

/** Runs SQL as postgres in the local database (the service role can't write admin_users). */
export function sql(statement: string): string {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement], {
    encoding: 'utf8',
  }).trim();
}

/** A quoted SQL literal. */
export const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;

export type TestUser = { id: string; email: string; firstName: string; lastName: string; secret: string | null };

/** A fresh confirmed account (unique email), optionally an admin, optionally with two-step already set up. */
export async function createUser(o: { role?: AdminRole; firstName?: string; lastName?: string; enrolled?: boolean } = {}): Promise<TestUser> {
  const firstName = o.firstName ?? 'Ada';
  const lastName = o.lastName ?? 'Admin';
  const email = `admin-${randomUUID().slice(0, 8)}@e2e.local`;
  const created = await serviceClient().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  if (o.role) sql(`insert into public.admin_users (user_id, role) values (${lit(id)}, ${lit(o.role)})`);
  const secret = o.enrolled ? await enrollTotp(email) : null;
  return { id, email, firstName, lastName, secret };
}

/** The current 6-digit code for a TOTP secret (RFC 6238: SHA-1, 30 s, 6 digits). */
export function totpCode(secret: string): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 }).generate();
}

/** Signs in with the password as a phone app would. */
export async function userClient(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

/** Sets up two-step for the account outside the browser. Returns the TOTP secret. */
export async function enrollTotp(email: string): Promise<string> {
  const client = await userClient(email);
  const enrolled = await client.auth.mfa.enroll({ factorType: 'totp' });
  if (enrolled.error) throw enrolled.error;
  const secret = enrolled.data.totp.secret;
  const verified = await client.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totpCode(secret) });
  if (verified.error) throw verified.error;
  return secret;
}

/** An aal2 session for the account (it must have two-step set up), for calling admin_* functions from a test. */
export async function aal2Client(user: TestUser): Promise<SupabaseClient<Database>> {
  if (!user.secret) throw new Error('aal2Client needs an enrolled user');
  const client = await userClient(user.email);
  const factors = await client.auth.mfa.listFactors();
  const factor = factors.data?.totp[0];
  if (!factor) throw new Error('No TOTP factor');
  const verified = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totpCode(user.secret) });
  if (verified.error) throw verified.error;
  return client;
}

/** Fills the sign-in form with the password only. */
export async function signInWithPassword(page: Page, user: TestUser) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Full sign-in (password, then the two-step code) for an enrolled admin. Ends on Overview. */
export async function signInAdmin(page: Page, user: TestUser) {
  if (!user.secret) throw new Error('signInAdmin needs an enrolled user');
  await signInWithPassword(page, user);
  await expect(page).toHaveURL(/\/mfa$/);
  await page.getByLabel('6-digit code').fill(totpCode(user.secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/overview$/);
}

/** Audit rows written for a target user (or by an admin), newest first. */
export function auditActions(o: { adminId?: string; targetId?: string }): string[] {
  const where = [o.adminId ? `admin_id = ${lit(o.adminId)}` : null, o.targetId ? `target_user_id = ${lit(o.targetId)}` : null]
    .filter(Boolean)
    .join(' and ');
  const out = sql(`select action from public.admin_audit_log where ${where || 'true'} order by id desc`);
  return out === '' ? [] : out.split('\n');
}
