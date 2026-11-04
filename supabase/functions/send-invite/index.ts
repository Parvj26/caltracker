import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  SendInvitesRequest,
  type SendInvitesResponse,
} from '@caltracker/shared';
import { renderInviteEmail } from './email.ts';
import { createMailer, type Mailer } from './mailer.ts';

export interface HandlerDeps {
  mailer: Mailer;
  supabaseAdmin: SupabaseClient;
  supabaseUrl: string;
  anonKey: string;
  /** Undefined means PUBLIC_SITE_URL is not set. */
  publicSiteUrl: string | undefined;
  /** True when invites go out through Resend (a real, public site URL is then required). */
  usesResend?: boolean;
  /** Minimum gap between sends, in ms. Resend allows 2 requests/second. 0 disables pacing. */
  sendIntervalMs?: number;
  /**
   * Time budget for one request, in ms (default 120 s). Edge Functions are cut off at 150 s, so rows not
   * reached in time are reported as `error` ("use Resend") and left untouched instead of half-processed.
   */
  budgetMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
  /** A resend within this window of the last send changes nothing (default 2 min). */
  resendCooldownMs?: number;
}

const DEFAULT_BUDGET_MS = 120_000;
const DEFAULT_RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ANOTHER_COACH_MESSAGE =
  "This person already trains with another coach on CalTracker. They'll need to leave that coach first.";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

type Result = SendInvitesResponse['results'][number];

export function createHandler(deps: HandlerDeps) {
  const { mailer, supabaseAdmin: admin } = deps;
  const siteUrl = deps.publicSiteUrl?.replace(/\/+$/, '');
  const sendIntervalMs = deps.sendIntervalMs ?? 0;
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const clock = deps.now ?? Date.now;
  const cooldownMs = deps.resendCooldownMs ?? DEFAULT_RESEND_COOLDOWN_MS;
  let lastSendAt = 0;

  return async (req: Request): Promise<Response> => {
    const startedAt = clock();
    if (req.method !== 'POST')
      return json({ error: 'Method not allowed' }, 405);

    // Real emails with a localhost link would be useless (and misleading), so refuse to send.
    if (deps.usesResend && !siteUrl) {
      console.error(
        'send-invite: RESEND_API_KEY is set but PUBLIC_SITE_URL is not; refusing to send invites',
      );
      return json({ error: 'Server misconfigured' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer '))
      return json({ error: 'Unauthorized' }, 401);

    // User-scoped client: identity and coach check run as the caller.
    const caller = createClient(deps.supabaseUrl, deps.anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await caller.auth.getUser(
      authHeader.slice('Bearer '.length),
    );
    if (userError || !userData.user)
      return json({ error: 'Unauthorized' }, 401);
    const userId = userData.user.id;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const parsed = SendInvitesRequest.safeParse(raw);
    if (!parsed.success)
      return json(
        { error: 'Invalid request', issues: parsed.error.issues },
        400,
      );
    const { workspaceId, invites } = parsed.data;

    // Authorization happens before any service-role access.
    const { data: isCoach, error: coachError } = await caller.rpc(
      'is_coach_of',
      {
        ws: workspaceId,
      },
    );
    if (coachError) return json({ error: 'Could not verify permissions' }, 500);
    if (isCoach !== true) return json({ error: 'Forbidden' }, 403);

    const [{ data: workspace }, { data: profile }] = await Promise.all([
      admin.from('workspaces').select('name').eq('id', workspaceId).single(),
      admin.from('profiles').select('full_name').eq('id', userId).single(),
    ]);
    const workspaceName = workspace?.name ?? 'CalTracker';
    const coachName = profile?.full_name?.trim() || 'Your coach';

    // Dedupe by email so one request cannot race itself.
    const unique = [...new Map(invites.map((i) => [i.email, i])).values()];

    const { data: members, error: lookupError } = await admin.rpc(
      'lookup_members_by_email',
      {
        emails: unique.map((i) => i.email),
      },
    );
    if (lookupError)
      return json({ error: 'Could not look up recipients' }, 500);
    const byEmail = new Map<string, { role: string; workspace_id: string }[]>();
    for (const m of members ?? []) {
      byEmail.set(m.email, [...(byEmail.get(m.email) ?? []), m]);
    }

    const results: Result[] = [];
    for (const invite of unique) {
      if (clock() - startedAt >= budgetMs) {
        // Out of time: touch nothing for this row (no row written, no token rotated).
        results.push({
          email: invite.email,
          status: 'error',
          message: 'Not sent yet — use Resend',
        });
        continue;
      }
      results.push(await processOne(invite, byEmail.get(invite.email) ?? []));
    }
    return json({ results } satisfies SendInvitesResponse);

    async function processOne(
      invite: { email: string; fullName: string },
      memberships: { role: string; workspace_id: string }[],
    ): Promise<Result> {
      const { email, fullName } = invite;
      try {
        if (memberships.some((m) => m.role === 'owner' || m.role === 'staff')) {
          return { email, status: 'is_coach' };
        }
        const clientOf = memberships.find((m) => m.role === 'client');
        if (clientOf?.workspace_id === workspaceId)
          return { email, status: 'already_member' };

        const { data: existing, error: findError } = await admin
          .from('client_invites')
          .select('id, sent_at')
          .eq('workspace_id', workspaceId)
          .eq('email', email)
          .is('accepted_at', null)
          .maybeSingle();
        if (findError) throw findError;

        // Double-click / retry guard: an email went out moments ago, so its link is still good.
        // Do not rotate the token (that would kill the link already in the inbox) and do not email again.
        if (existing && Date.now() - new Date(existing.sent_at).getTime() < cooldownMs) {
          return {
            email,
            status: clientOf ? 'with_another_coach' : 'resent',
            message: clientOf
              ? ANOTHER_COACH_MESSAGE
              : 'Already sent a moment ago. The link in that email still works.',
          };
        }

        const token = newToken();
        const now = new Date();
        const sentAt = now.toISOString();
        const expiresAt = new Date(now.getTime() + 14 * DAY_MS);
        const tokenHash = await sha256Hex(token);

        if (existing) {
          const { error } = await admin
            .from('client_invites')
            .update({
              token_hash: tokenHash,
              full_name: fullName,
              sent_at: sentAt,
              expires_at: expiresAt.toISOString(),
            })
            .eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await admin.from('client_invites').insert({
            workspace_id: workspaceId,
            email,
            full_name: fullName,
            token_hash: tokenHash,
            sent_at: sentAt,
            expires_at: expiresAt.toISOString(),
            created_by: userId,
          });
          if (error) throw error;
        }

        const message = renderInviteEmail({
          clientName: fullName,
          coachName,
          workspaceName,
          acceptUrl: `${siteUrl ?? 'http://localhost:3000'}/invite/${token}`,
          expiresAt,
        });
        try {
          const wait = lastSendAt + sendIntervalMs - Date.now();
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          lastSendAt = Date.now();
          await mailer.send({ to: email, ...message });
        } catch (err) {
          console.error(
            'send-invite: email failed',
            err instanceof Error ? err.message : 'unknown',
          );
          // Nothing was delivered, so Resend must not be blocked by the cooldown: backdate the send.
          // (expires_at must stay within 14 days of sent_at, so it moves with it.)
          const backdated = new Date(
            now.getTime() - cooldownMs - 1000,
          );
          await admin
            .from('client_invites')
            .update({
              sent_at: backdated.toISOString(),
              expires_at: new Date(backdated.getTime() + 14 * DAY_MS).toISOString(),
            })
            .eq('workspace_id', workspaceId)
            .eq('email', email)
            .is('accepted_at', null);
          return {
            email,
            status: 'error',
            message: "We couldn't send this email. Use Resend to try again.",
          };
        }

        if (clientOf)
          return {
            email,
            status: 'with_another_coach',
            message: ANOTHER_COACH_MESSAGE,
          };
        return { email, status: existing ? 'resent' : 'sent' };
      } catch (err) {
        console.error(
          'send-invite: row failed',
          err instanceof Error ? err.message : 'unknown',
        );
        return {
          email,
          status: 'error',
          message: 'Something went wrong. Please try again.',
        };
      }
    }
  };
}

if (import.meta.main) {
  const env = Deno.env;
  const usesResend = Boolean(env.get('RESEND_API_KEY'));
  Deno.serve(
    createHandler({
      mailer: createMailer(env),
      supabaseAdmin: createClient(
        env.get('SUPABASE_URL')!,
        env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      ),
      supabaseUrl: env.get('SUPABASE_URL')!,
      anonKey: env.get('SUPABASE_ANON_KEY')!,
      publicSiteUrl:
        env.get('PUBLIC_SITE_URL') ??
        (usesResend ? undefined : 'http://localhost:3000'),
      usesResend,
      // Resend allows 2 requests/second: keep a gap a little over 500ms between sends.
      sendIntervalMs: usesResend ? 550 : 0,
    }),
  );
}
