import {
  AcceptInviteResponse,
  INVITE_TOKEN_PATTERN,
  type AcceptInviteReason,
  type AcceptInviteRequest,
  type Database,
} from '@caltracker/shared';
import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

// Join from the invite link (docs/superpowers/specs/2026-11-05-invite-join-design.md).

type Client = Pick<SupabaseClient<Database>, 'rpc' | 'functions' | 'auth'>;

export type InviteDetails =
  | { status: 'valid'; workspaceName: string; email: string; firstName: string; lastName: string }
  | { status: 'expired' | 'used' | 'not_found' | 'offline' | 'server' };

/** What the coach entered for this invite, so the Join screen can pre-fill it. Never throws. */
export async function loadInvite(client: Client, token: string | undefined): Promise<InviteDetails> {
  if (!token || !INVITE_TOKEN_PATTERN.test(token)) return { status: 'not_found' };
  try {
    const { data, error } = await client.rpc('get_invite_preview', { token });
    // A response with an error code came from the server (it refused); no code means the request never got through.
    if (error) return { status: error.code ? 'server' : 'offline' };
    const row = data[0];
    if (!row) return { status: 'not_found' };
    if (row.status === 'valid' && row.workspace_name && row.email) {
      return {
        status: 'valid',
        workspaceName: row.workspace_name,
        email: row.email,
        firstName: row.first_name ?? '',
        lastName: row.last_name ?? '',
      };
    }
    if (row.status === 'accepted') return { status: 'used' };
    if (row.status === 'expired') return { status: 'expired' };
    return { status: 'not_found' };
  } catch {
    return { status: 'offline' };
  }
}

export type JoinFailure =
  | { ok: false; reason: AcceptInviteReason | 'offline' | 'server' }
  /** The account exists and is linked, but signing in right after failed: they can sign in normally. */
  | { ok: false; reason: 'joined_sign_in_failed'; email: string };
export type JoinResult = { ok: true; email: string } | JoinFailure;

async function readBody(error: FunctionsHttpError): Promise<unknown> {
  try {
    return await (error.context as Response).json();
  } catch {
    return null;
  }
}

/** Creates the account from the invite, then signs in. A signed-in session takes the app to Today. Never throws. */
export async function joinInvite(client: Client, input: AcceptInviteRequest): Promise<JoinResult> {
  let body: unknown;
  try {
    const res = await client.functions.invoke<unknown>('accept-invite', { body: input });
    // functions-js types the error as any.
    const error: unknown = res.error;
    const data = res.data;
    if (error instanceof FunctionsFetchError) return { ok: false, reason: 'offline' };
    body = error instanceof FunctionsHttpError ? await readBody(error) : error ? null : data;
  } catch {
    return { ok: false, reason: 'offline' };
  }
  const parsed = AcceptInviteResponse.safeParse(body);
  if (!parsed.success) return { ok: false, reason: 'server' };
  if (!parsed.data.ok) return parsed.data;

  const { email } = parsed.data;
  const { error } = await client.auth.signInWithPassword({ email, password: input.password });
  if (error) return { ok: false, reason: 'joined_sign_in_failed', email };
  return { ok: true, email };
}

/** Plain-language copy for each way joining can fail. */
export function joinMessage(reason: JoinFailure['reason'], workspaceName: string): string {
  switch (reason) {
    case 'not_found':
      return "This invite link isn't valid. Ask your coach to send a new one.";
    case 'expired':
      return 'This invite has expired. Ask your coach to send a new one.';
    case 'used':
      return 'This invite has already been used. Sign in instead.';
    case 'account_exists':
      return `You already have an account. Sign in to join ${workspaceName}.`;
    case 'coach_account':
      return 'This email is a coach account. Ask your coach to invite a different email.';
    case 'other_coach':
      return 'This account already trains with another coach on CalTracker.';
    case 'weak_password':
      return 'Choose a stronger password: make it longer, or mix in numbers and symbols.';
    case 'invalid_request':
      return 'Check your name and password, then try again.';
    case 'offline':
      return 'No connection. Check your internet and try again.';
    case 'server':
      return 'Something went wrong. Please try again.';
    case 'joined_sign_in_failed':
      return "You're all set. Sign in with your email and new password.";
  }
}
