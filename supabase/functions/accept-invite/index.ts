import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AcceptInviteRequest, type AcceptInviteResponse } from '@caltracker/shared';

// Join from the invite link (docs/superpowers/specs/2026-11-05-invite-join-design.md).
// The raw invite token is the proof: it was emailed to the invited address, so holding it proves the
// client owns that inbox, and the account can be created already confirmed (no second email).
// The app then signs in with the email and password itself; no session is minted here.

export interface HandlerDeps {
  /** Service-role client. Lives only in this Edge Function, never in app code. */
  supabaseAdmin: SupabaseClient;
}

type JoinRow = {
  invite_id: string | null;
  status: 'valid' | 'expired' | 'used' | 'not_found';
  email: string | null;
  user_id: string | null;
  user_confirmed: boolean;
  user_is_coach: boolean;
};

const json = (body: AcceptInviteResponse | { error: string }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refuse = (reason: Extract<AcceptInviteResponse, { ok: false }>['reason'], status = 200) =>
  json({ ok: false, reason }, status);
const serverError = () => json({ error: 'Something went wrong. Please try again.' }, 500);

/** Never log the password or token: only the step and the error message. */
function logFailure(step: string, err: unknown) {
  console.error(`accept-invite: ${step} failed`, err instanceof Error ? err.message : String(err));
}

export function createHandler({ supabaseAdmin: admin }: HandlerDeps) {
  async function accountNowExists(token: string): Promise<boolean> {
    const { data } = await admin.rpc('invite_for_join', { token });
    const row = (Array.isArray(data) ? data[0] : data) as JoinRow | undefined;
    return Boolean(row?.user_id);
  }

  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return refuse('invalid_request', 400);
    }
    const parsed = AcceptInviteRequest.safeParse(raw);
    if (!parsed.success) return refuse('invalid_request', 400);
    const { token, password, firstName, lastName } = parsed.data;

    const metadata = { first_name: firstName, last_name: lastName };

    // Two passes at most: if someone else creates an account with this email between our lookup and our
    // createUser, look again and take the path that fits what now exists.
    for (let pass = 0; pass < 2; pass++) {
      const { data: rows, error: lookupError } = await admin.rpc('invite_for_join', { token });
      if (lookupError) {
        logFailure('invite lookup', lookupError);
        return serverError();
      }
      const row = (Array.isArray(rows) ? rows[0] : rows) as JoinRow | undefined;
      if (!row || row.status === 'not_found' || !row.invite_id || !row.email) return refuse('not_found');
      if (row.status !== 'valid') return refuse(row.status);
      if (row.user_is_coach) return refuse('coach_account');
      // Someone already uses this account: never change its password. Signing in links the coach.
      if (row.user_id && row.user_confirmed) return refuse('account_exists');

      let userId: string;
      let createdHere = false;
      if (row.user_id) {
        // Signed up once but never confirmed. Holding the token proves the inbox, so take the account over:
        // a new password locks out anyone who registered this email without owning it.
        const { error } = await admin.auth.admin.updateUserById(row.user_id, {
          password,
          email_confirm: true,
          user_metadata: metadata,
        });
        if (error) {
          if (error.code === 'weak_password') return refuse('weak_password');
          logFailure('confirm unconfirmed account', error);
          return serverError();
        }
        const { error: profileError } = await admin
          .from('profiles')
          .update({ first_name: firstName, last_name: lastName })
          .eq('id', row.user_id);
        if (profileError) logFailure('profile name update', profileError);
        userId = row.user_id;
      } else {
        const { data, error } = await admin.auth.admin.createUser({
          email: row.email,
          password,
          email_confirm: true,
          user_metadata: metadata,
        });
        if (error || !data.user) {
          if (error?.code === 'weak_password') return refuse('weak_password');
          // An account with this email appeared a moment ago (a second tap on Join, or a regular sign-up).
          // Auth reports that as email_exists or as a database error depending on timing: look again.
          if (error?.code === 'email_exists' || (await accountNowExists(token))) continue;
          logFailure('create account', error);
          return serverError();
        }
        userId = data.user.id;
        createdHere = true;
      }

      const { data: outcome, error: acceptError } = await admin.rpc('accept_invite_for', {
        p_invite_id: row.invite_id,
        p_user_id: userId,
      });
      if (!acceptError && outcome === 'ok') return json({ ok: true, email: row.email });

      if (acceptError) logFailure('accept', acceptError);
      if (createdHere) {
        // Don't leave behind an account nobody asked for.
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) logFailure('remove unused account', error);
      } else if (outcome === 'used' || outcome === 'expired' || outcome === 'not_found') {
        // The invite changed under us (another tap, a resend or a cancel), but the account is now confirmed with
        // the password just chosen. Signing in works, and links the coach if an open invite remains.
        return refuse('account_exists');
      }
      if (outcome === 'used' || outcome === 'expired' || outcome === 'not_found') return refuse(outcome);
      if (outcome === 'coach_account' || outcome === 'other_coach') return refuse(outcome);
      if (outcome) logFailure('accept', new Error(String(outcome)));
      return serverError();
    }
    return refuse('account_exists');
  };
}

if (import.meta.main) {
  const env = Deno.env;
  Deno.serve(
    createHandler({
      supabaseAdmin: createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    }),
  );
}
