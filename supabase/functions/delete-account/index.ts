import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createMailer, type Mailer } from '../send-invite/mailer.ts';
import { purgeStorage as defaultPurgeStorage, type StorageObject } from '../_shared/purge-storage.ts';
import { renderClientDeletedEmail } from './email.ts';
import { createPosthogEraser, type PosthogEraser } from './posthog.ts';

// "Delete my account" from the phone (Apple requires it in the app; go-live plan Task 3).
// POST, no body, the signed-in client's JWT. Only that client can delete themselves: the user comes from the JWT.
//   200 { deleted: true }                        done (also when the account was already deleted: safe to retry)
//   401 { error: 'unauthorized' }                no or bad JWT
//   409 { error: 'coach_account', message }      coaches close their account by email instead
//   500 { error: 'retry' }                       files or account not removed yet; nothing told to the coach
// Order: who is it → refuse coaches → capture name and coach email → remove files → delete the auth user (the
// database erases every row with it, migration 20261110000100) → then, best effort, a second file sweep, PostHog and
// the coach's email.

export const COACH_ACCOUNT_MESSAGE =
  "Coach accounts are closed by email. Write to support@caltracker.app and we'll do it for you.";

export interface HandlerDeps {
  /** Service-role client. Lives only in this Edge Function, never in app code. */
  supabaseAdmin: SupabaseClient;
  supabaseUrl: string;
  anonKey: string;
  mailer: Mailer;
  /** Null when no PostHog server key is configured: that step is skipped. */
  posthog: PosthogEraser | null;
  /** Injectable for tests (e.g. a storage failure). */
  purgeStorage?: (admin: SupabaseClient, objects: StorageObject[]) => Promise<{ removed: number }>;
}

type DeletionInfo = {
  is_coach: boolean;
  client_name: string;
  coach_email: string | null;
  coach_first_name: string | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const done = () => json({ deleted: true });
const retry = () => json({ error: 'retry' }, 500);

/** Logs the step and message only: never tokens, emails or names. */
function logFailure(step: string, err: unknown) {
  console.error(`delete-account: ${step} failed`, err instanceof Error ? err.message : String(err));
}

export function createHandler(deps: HandlerDeps) {
  const { supabaseAdmin: admin } = deps;
  const purge = deps.purgeStorage ?? defaultPurgeStorage;

  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
    const token = authHeader.slice('Bearer '.length);
    const caller = createClient(deps.supabaseUrl, deps.anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await caller.auth.getUser(token);
    if (userError?.code === 'user_not_found') return done(); // a valid JWT whose account is already gone
    if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const { data: infoRows, error: infoError } = await admin.rpc('account_deletion_info', { p_user: userId });
    if (infoError) {
      logFailure('read account', infoError);
      return retry();
    }
    const info = (Array.isArray(infoRows) ? infoRows[0] : infoRows) as DeletionInfo | undefined;
    if (info?.is_coach) return json({ error: 'coach_account', message: COACH_ACCOUNT_MESSAGE }, 409);

    // Files first: once the auth user is gone this JWT no longer works, so a retry could not find them.
    const { data: objects, error: listError } = await admin.rpc('storage_objects_for_user', { p_user: userId });
    if (listError) {
      logFailure('list files', listError);
      return retry();
    }
    try {
      await purge(admin, (objects ?? []) as StorageObject[]);
    } catch (err) {
      logFailure('remove files', err);
      return retry();
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError && deleteError.code !== 'user_not_found') {
      logFailure('delete account', deleteError);
      return retry();
    }

    // The data is gone. From here nothing can fail the deletion.

    // Sweep once more: a coach upload into the client's folders can race in between the first sweep and the delete.
    try {
      const { data: late, error: lateError } = await admin.rpc('storage_objects_for_user', { p_user: userId });
      if (lateError) throw lateError;
      await purge(admin, (late ?? []) as StorageObject[]);
    } catch (err) {
      logFailure('second file sweep', err);
    }

    if (deps.posthog) {
      try {
        const outcome = await deps.posthog.erase(userId);
        if (outcome === 'ambiguous') {
          console.error('delete-account: PostHog has more than one person for this user; deleted none (check by hand)');
        }
      } catch (err) {
        logFailure('PostHog person delete', err);
      }
    } else {
      console.log('delete-account: PostHog server key not configured; skipping PostHog person delete');
    }

    if (info?.coach_email) {
      try {
        await deps.mailer.send({
          to: info.coach_email,
          ...renderClientDeletedEmail({
            coachFirstName: info.coach_first_name ?? '',
            clientName: info.client_name,
          }),
        });
      } catch (err) {
        logFailure('coach email', err);
      }
    }

    return done();
  };
}

if (import.meta.main) {
  const env = Deno.env;
  Deno.serve(
    createHandler({
      supabaseAdmin: createClient(env.get('SUPABASE_URL')!, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      supabaseUrl: env.get('SUPABASE_URL')!,
      anonKey: env.get('SUPABASE_ANON_KEY')!,
      mailer: createMailer(env),
      posthog: createPosthogEraser(env),
    }),
  );
}
