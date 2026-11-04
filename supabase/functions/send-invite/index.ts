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
  publicSiteUrl: string;
}

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

  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST')
      return json({ error: 'Method not allowed' }, 405);

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

        const token = newToken();
        const now = new Date();
        const sentAt = now.toISOString();
        const expiresAt = new Date(now.getTime() + 14 * DAY_MS);
        const tokenHash = await sha256Hex(token);

        const { data: existing, error: findError } = await admin
          .from('client_invites')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('email', email)
          .is('accepted_at', null)
          .maybeSingle();
        if (findError) throw findError;

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
          acceptUrl: `${deps.publicSiteUrl}/invite/${token}`,
          expiresAt,
        });
        try {
          await mailer.send({ to: email, ...message });
        } catch (err) {
          console.error(
            'send-invite: email failed',
            err instanceof Error ? err.message : 'unknown',
          );
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
      publicSiteUrl: env.get('PUBLIC_SITE_URL') ?? 'http://localhost:3000',
    }),
  );
}
