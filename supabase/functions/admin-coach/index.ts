import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AdminCoachRequest } from '@caltracker/shared';
import { createMailer, type Mailer } from '../send-invite/mailer.ts';
import { purgeStorage as defaultPurgeStorage, type StorageObject } from '../_shared/purge-storage.ts';
import { renderWorkspaceClosedEmail } from './email.ts';

// Admin site "Add coach" and "Delete coach" (owner admins only, two-step sign-in). The admin site has no service-role
// key: it calls this function with the admin's JWT, as it does send-invite. Migration 20261110003000_admin_coach.sql.
//
// POST { action: 'create', email, firstName, lastName, workspaceName }
//   200 { created: true, userId, workspaceId }
//   409 { error: 'is_coach' | 'is_admin' | 'has_account', message }   the email can't become a new coach
// POST { action: 'delete', workspaceId, confirmName }
//   200 { deleted: true, workspaceName, clientsEmailed, emailsFailed, accountsNotDeleted }
//   400 { error: 'confirm_mismatch', message }   404 { error: 'not_found', message }   409 { error: 'blocked', message }
// Both: 401 no or bad JWT; 403 not an owner, or not signed in with two-step (aal1); 500 { error: 'retry', message }.
//
// Delete order: check (owner, preview, typed name, blockers) → remove the files (Storage API; a failure stops here, so
// nothing is deleted and a retry starts over) → delete the workspace in one transaction (audit row, closed-workspace
// clients, every row) → delete the coaches' accounts → a second file sweep → email the clients. From the workspace
// delete on, nothing fails the request: problems are logged and counted.

export interface HandlerDeps {
  /** Service-role client. Lives only in this Edge Function, never in the admin site. */
  supabaseAdmin: SupabaseClient;
  /** A client that runs as the caller (their JWT), for the owner check and the preview. */
  createCallerClient: (authHeader: string) => SupabaseClient;
  mailer: Mailer;
  /** Where the set-password link in the coach's invite email points. Undefined means not configured. */
  publicSiteUrl: string | undefined;
  /** Minimum gap between client emails, in ms (Resend allows 2 requests/second). 0 disables pacing. */
  sendIntervalMs?: number;
  /** Injectable for tests (e.g. a storage failure). */
  purgeStorage?: (admin: SupabaseClient, objects: StorageObject[]) => Promise<{ removed: number }>;
}

type DbError = { code?: string; message?: string } | null;

type Preview = {
  workspace_name: string;
  coach_name: string;
  delete_account_ids: string[];
  blocker: string;
};

type DeleteResult = {
  workspace_name: string;
  coach_name: string;
  delete_account_ids: string[];
  clients: { user_id: string; email: string; first_name: string }[];
};

export const MESSAGES = {
  isCoach: 'That email already belongs to a coach or staff member.',
  isAdmin: 'That email belongs to a CalTracker admin.',
  hasAccount:
    'That email already has a CalTracker account (a client). Adding an existing client as a coach isn’t supported yet.',
  confirmMismatch: 'Type the workspace name exactly to confirm.',
  notFound: 'That workspace no longer exists.',
  retry: 'Something went wrong and nothing was deleted. Please try again.',
  createFailed: 'Couldn’t add the coach. Please try again.',
} as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Logs the step and message only: never tokens, emails or names. */
function logFailure(step: string, err: unknown) {
  const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
  console.error(`admin-coach: ${step} failed`, message);
}

/** The database's "admin: …" message as a sentence, or null. */
function adminMessage(error: DbError): string | null {
  const m = /^admin: (.+)$/.exec(error?.message ?? '');
  if (!m) return null;
  const text = m[1]!;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
}

export function createHandler(deps: HandlerDeps) {
  const { supabaseAdmin: admin, mailer } = deps;
  const purge = deps.purgeStorage ?? defaultPurgeStorage;
  const siteUrl = deps.publicSiteUrl?.replace(/\/+$/, '');
  const sendIntervalMs = deps.sendIntervalMs ?? 0;

  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
    const caller = deps.createCallerClient(authHeader);
    const { data: userData, error: userError } = await caller.auth.getUser(authHeader.slice('Bearer '.length));
    if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);
    const adminId = userData.user.id;

    // Owner and two-step (aal2), checked by the database from the caller's JWT, before any service-role access.
    const { data: isOwner, error: ownerError } = await caller.rpc('admin_require_owner');
    if (ownerError && ownerError.code !== '42501') logFailure('owner check', ownerError);
    if (ownerError || isOwner !== true) return json({ error: 'forbidden' }, 403);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: 'invalid_request' }, 400);
    }
    const parsed = AdminCoachRequest.safeParse(raw);
    if (!parsed.success) return json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    const body = parsed.data;

    if (body.action === 'create') {
      if (!siteUrl) {
        console.error('admin-coach: PUBLIC_SITE_URL is not set; refusing to send a coach invite');
        return json({ error: 'misconfigured' }, 500);
      }
      const { data: status, error: statusError } = await admin.rpc('admin_coach_email_status', {
        p_admin_id: adminId,
        p_email: body.email,
      });
      if (statusError) {
        logFailure('email check', statusError);
        return statusError.code === '42501' ? json({ error: 'forbidden' }, 403) : json({ error: 'retry', message: MESSAGES.createFailed }, 500);
      }
      if (status === 'coach') return json({ error: 'is_coach', message: MESSAGES.isCoach }, 409);
      if (status === 'admin') return json({ error: 'is_admin', message: MESSAGES.isAdmin }, 409);
      if (status !== 'new') return json({ error: 'has_account', message: MESSAGES.hasAccount }, 409);

      // Creates the account and sends Supabase Auth's invite ("set your password") email.
      const invite = await admin.auth.admin.inviteUserByEmail(body.email, {
        data: { first_name: body.firstName, last_name: body.lastName },
        redirectTo: `${siteUrl}/set-password`,
      });
      if (invite.error || !invite.data.user) {
        if (invite.error?.code === 'email_exists') return json({ error: 'has_account', message: MESSAGES.hasAccount }, 409);
        logFailure('invite', invite.error);
        return json({ error: 'retry', message: MESSAGES.createFailed }, 500);
      }
      const userId = invite.data.user.id;

      const { data: workspaceId, error: createError } = await admin.rpc('admin_create_coach', {
        p_admin_id: adminId,
        p_user_id: userId,
        p_workspace_name: body.workspaceName,
      });
      if (createError || typeof workspaceId !== 'string') {
        logFailure('create workspace', createError);
        // Undo the account, so the same email can be tried again.
        const { error: undoError } = await admin.auth.admin.deleteUser(userId);
        if (undoError) logFailure('undo invite', undoError);
        return json({ error: 'retry', message: adminMessage(createError) ?? MESSAGES.createFailed }, 500);
      }
      return json({ created: true, userId, workspaceId });
    }

    // ---- delete ----
    const { data: previewData, error: previewError } = await caller.rpc('admin_coach_delete_preview', {
      p_workspace_id: body.workspaceId,
    });
    if (previewError) {
      if (previewError.code === 'P0002') return json({ error: 'not_found', message: MESSAGES.notFound }, 404);
      if (previewError.code === '42501') return json({ error: 'forbidden' }, 403);
      logFailure('preview', previewError);
      return json({ error: 'retry', message: MESSAGES.retry }, 500);
    }
    const preview = previewData as Preview;
    if (body.confirmName !== preview.workspace_name) {
      return json({ error: 'confirm_mismatch', message: MESSAGES.confirmMismatch }, 400);
    }
    if (preview.blocker) return json({ error: 'blocked', message: preview.blocker }, 409);
    const accountIds = preview.delete_account_ids ?? [];

    // Files first: if this fails, nothing is deleted and a retry starts over.
    const { data: files, error: filesError } = await admin.rpc('admin_coach_delete_files', {
      p_workspace_id: body.workspaceId,
      p_user_ids: accountIds,
    });
    if (filesError) {
      logFailure('list files', filesError);
      return json({ error: 'retry', message: MESSAGES.retry }, 500);
    }
    try {
      await purge(admin, (files ?? []) as StorageObject[]);
    } catch (err) {
      logFailure('remove files', err);
      return json({ error: 'retry', message: MESSAGES.retry }, 500);
    }

    const { data: deletedData, error: deleteError } = await admin.rpc('admin_delete_coach', {
      p_admin_id: adminId,
      p_workspace_id: body.workspaceId,
      p_confirm_name: body.confirmName,
    });
    if (deleteError) {
      if (deleteError.code === 'P0002') return json({ error: 'not_found', message: MESSAGES.notFound }, 404);
      if (deleteError.code === '42501') return json({ error: 'forbidden' }, 403);
      const message = adminMessage(deleteError);
      if (message && (deleteError.code === '55000' || deleteError.code === '22023')) {
        return json({ error: 'blocked', message }, 409);
      }
      logFailure('delete workspace', deleteError);
      return json({ error: 'retry', message: 'Couldn’t delete the workspace. Its files may be gone already; please try again.' }, 500);
    }
    const deleted = deletedData as DeleteResult;

    // The workspace is gone. From here nothing fails the request.
    let accountsNotDeleted = 0;
    for (const id of deleted.delete_account_ids ?? []) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error && error.code !== 'user_not_found') {
        accountsNotDeleted++;
        logFailure('delete coach account', error);
      }
    }

    // Sweep once more: an upload can race in between the first sweep and the delete.
    try {
      const { data: late, error: lateError } = await admin.rpc('admin_coach_delete_files', {
        p_workspace_id: body.workspaceId,
        p_user_ids: deleted.delete_account_ids ?? [],
      });
      if (lateError) throw lateError;
      await purge(admin, (late ?? []) as StorageObject[]);
    } catch (err) {
      logFailure('second file sweep', err);
    }

    let clientsEmailed = 0;
    let emailsFailed = 0;
    let lastSendAt = 0;
    for (const client of deleted.clients ?? []) {
      try {
        const wait = lastSendAt + sendIntervalMs - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastSendAt = Date.now();
        await mailer.send({
          to: client.email,
          ...renderWorkspaceClosedEmail({ clientFirstName: client.first_name, coachName: deleted.coach_name }),
        });
        clientsEmailed++;
      } catch (err) {
        emailsFailed++;
        logFailure('client email', err);
      }
    }

    return json({
      deleted: true,
      workspaceName: deleted.workspace_name,
      clientsEmailed,
      emailsFailed,
      accountsNotDeleted,
    });
  };
}

if (import.meta.main) {
  const env = Deno.env;
  const usesResend = Boolean(env.get('RESEND_API_KEY'));
  const supabaseUrl = env.get('SUPABASE_URL')!;
  const anonKey = env.get('SUPABASE_ANON_KEY')!;
  // Client emails come from hello@ (mockup); invites keep invites@. The domain is verified once in Resend.
  const mailerEnv = {
    get: (key: string) =>
      key === 'INVITE_FROM_EMAIL' ? (env.get('NOTICE_FROM_EMAIL') ?? 'CalTracker <hello@caltracker.app>') : env.get(key),
  };
  Deno.serve(
    createHandler({
      supabaseAdmin: createClient(supabaseUrl, env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      createCallerClient: (authHeader) =>
        createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
          auth: { persistSession: false, autoRefreshToken: false },
        }),
      mailer: createMailer(mailerEnv),
      publicSiteUrl: env.get('PUBLIC_SITE_URL') ?? (usesResend ? undefined : 'http://localhost:3000'),
      sendIntervalMs: usesResend ? 550 : 0,
    }),
  );
}
