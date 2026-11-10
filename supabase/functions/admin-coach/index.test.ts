import { assert, assertEquals } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Mailer } from '../send-invite/mailer.ts';
import type { StorageObject } from '../_shared/purge-storage.ts';
import { createHandler, MESSAGES, type HandlerDeps } from './index.ts';

// Mocked Supabase clients only: no local stack needed. The database half is proven by
// supabase/tests/admin_coach.test.sql.

const OWNER = '00000000-0000-4000-8000-000000000001';
const WS = '00000000-0000-4000-8000-0000000000aa';
const COACH = '00000000-0000-4000-8000-000000000002';
const STAFF = '00000000-0000-4000-8000-000000000003';
const NEW_USER = '00000000-0000-4000-8000-000000000009';

type Result = { data: unknown; error: { code?: string; message: string } | null };
type Call = { name: string; args?: unknown };
const ok = (data: unknown): Result => ({ data, error: null });
const fail = (code: string, message = 'boom'): Result => ({ data: null, error: { code, message } });

/**
 * The caller's client. Tokens: 'owner' (owner at aal2), 'owner-aal1' (owner, password only), 'support', 'bad'
 * (invalid JWT). The database's admin_require_owner raises 42501 for everyone but the aal2 owner.
 */
function fakeCaller(token: string, rpcs: Record<string, Result> = {}, calls: Call[] = []) {
  return {
    auth: {
      getUser: (_jwt: string) =>
        Promise.resolve(
          token === 'bad'
            ? { data: { user: null }, error: { message: 'invalid JWT' } }
            : { data: { user: { id: OWNER } }, error: null },
        ),
    },
    rpc: (name: string, args?: unknown) => {
      calls.push({ name, args });
      if (name === 'admin_require_owner') {
        return Promise.resolve(token === 'owner' ? ok(true) : fail('42501', 'admin: not authorised'));
      }
      return Promise.resolve(rpcs[name] ?? fail('XX000', `unexpected rpc ${name}`));
    },
  } as unknown as SupabaseClient;
}

function fakeAdmin(o: {
  rpcs?: Record<string, Result | Result[]>;
  invite?: { data: { user: { id: string } | null }; error: { code?: string; message: string } | null };
  deleteUserError?: Record<string, { code?: string; message: string }>;
} = {}) {
  const calls: Call[] = [];
  const removed: StorageObject[] = [];
  const invited: { email: string; options: unknown }[] = [];
  const deletedUsers: string[] = [];
  const queues = new Map(Object.entries(o.rpcs ?? {}).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const client = {
    rpc: (name: string, args?: unknown) => {
      calls.push({ name, args });
      const q = queues.get(name);
      if (!q || q.length === 0) return Promise.resolve(fail('XX000', `unexpected rpc ${name}`));
      return Promise.resolve(q.length > 1 ? q.shift()! : q[0]!);
    },
    auth: {
      admin: {
        inviteUserByEmail: (email: string, options: unknown) => {
          invited.push({ email, options });
          return Promise.resolve(o.invite ?? { data: { user: { id: NEW_USER } }, error: null });
        },
        deleteUser: (id: string) => {
          deletedUsers.push(id);
          return Promise.resolve({ data: {}, error: o.deleteUserError?.[id] ?? null });
        },
      },
    },
    storage: {
      from: (bucket: string) => ({
        remove: (names: string[]) => {
          for (const name of names) removed.push({ bucket_id: bucket, name });
          return Promise.resolve({ data: [], error: null });
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, calls, removed, invited, deletedUsers };
}

type Sent = Parameters<Mailer['send']>[0];
function fakeMailer(failFor: string[] = []) {
  const sent: Sent[] = [];
  const mailer: Mailer = {
    send(msg) {
      if (failFor.includes(msg.to)) return Promise.reject(new Error('Resend down'));
      sent.push(msg);
      return Promise.resolve();
    },
  };
  return { mailer, sent };
}

function setup(o: {
  token?: string;
  admin?: ReturnType<typeof fakeAdmin>;
  callerRpcs?: Record<string, Result>;
  mailer?: ReturnType<typeof fakeMailer>;
  deps?: Partial<HandlerDeps>;
} = {}) {
  const admin = o.admin ?? fakeAdmin();
  const mail = o.mailer ?? fakeMailer();
  const callerCalls: Call[] = [];
  const handler = createHandler({
    supabaseAdmin: admin.client,
    createCallerClient: () => fakeCaller(o.token ?? 'owner', o.callerRpcs, callerCalls),
    mailer: mail.mailer,
    publicSiteUrl: 'https://caltracker.app/',
    ...o.deps,
  });
  const call = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${o.token ?? 'owner'}` }) =>
    handler(new Request('http://x/admin-coach', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { handler, call, admin, mail, callerCalls };
}

const createBody = {
  action: 'create',
  email: ' Sam@SamFit.com ',
  firstName: 'Sam',
  lastName: 'Rivera',
  workspaceName: 'Sam Fit Coaching',
};
const deleteBody = { action: 'delete', workspaceId: WS, confirmName: 'Luis Bueno Coaching' };
const preview = {
  workspace_name: 'Luis Bueno Coaching',
  coach_name: 'Luis Bueno',
  delete_account_ids: [COACH, STAFF],
  blocker: '',
};
const deleteResult = {
  workspace_name: 'Luis Bueno Coaching',
  coach_name: 'Luis Bueno',
  delete_account_ids: [COACH, STAFF],
  clients: [
    { user_id: 'k', email: 'kay@x.test', first_name: 'Kay' },
    { user_id: 'v', email: 'vic@x.test', first_name: 'Vic' },
  ],
};
const files = [
  { bucket_id: 'meal-photos', name: `${WS}/v/m.webp` },
  { bucket_id: 'avatars', name: `${COACH}/avatar.webp` },
];

// ---------- Auth ----------

Deno.test('401 without a bearer token, and for a bad JWT', async () => {
  const { call, admin } = setup({ token: 'bad' });
  assertEquals((await call(createBody, {})).status, 401);
  assertEquals((await call(createBody)).status, 401);
  assertEquals(admin.calls.length, 0);
});

Deno.test('403 for support and for an owner without two-step (aal1); no service-role call is made', async () => {
  for (const token of ['support', 'owner-aal1']) {
    const { call, admin } = setup({ token });
    const create = await call(createBody);
    assertEquals(create.status, 403, token);
    const del = await call(deleteBody);
    assertEquals(del.status, 403, token);
    assertEquals(admin.calls.length, 0, token);
    assertEquals(admin.invited.length, 0, token);
  }
});

Deno.test('405 for GET, 400 for a bad body', async () => {
  const { handler, call } = setup();
  assertEquals((await handler(new Request('http://x', { method: 'GET' }))).status, 405);
  assertEquals((await call({ action: 'create', email: 'nope' })).status, 400);
  assertEquals((await call({ action: 'delete', workspaceId: 'x', confirmName: 'y' })).status, 400);
});

// ---------- Create ----------

Deno.test('create: invites the coach, creates the workspace as the calling owner', async () => {
  const admin = fakeAdmin({ rpcs: { admin_coach_email_status: ok('new'), admin_create_coach: ok(WS) } });
  const { call } = setup({ admin });
  const res = await call(createBody);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { created: true, userId: NEW_USER, workspaceId: WS });
  assertEquals(admin.invited, [
    {
      email: 'sam@samfit.com',
      options: { data: { first_name: 'Sam', last_name: 'Rivera' }, redirectTo: 'https://caltracker.app/set-password' },
    },
  ]);
  assertEquals(admin.calls, [
    { name: 'admin_coach_email_status', args: { p_admin_id: OWNER, p_email: 'sam@samfit.com' } },
    { name: 'admin_create_coach', args: { p_admin_id: OWNER, p_user_id: NEW_USER, p_workspace_name: 'Sam Fit Coaching' } },
  ]);
});

Deno.test('create: refuses a coach, an admin or an existing client account, with a clear message and no invite', async () => {
  for (const [status, error, message] of [
    ['coach', 'is_coach', MESSAGES.isCoach],
    ['admin', 'is_admin', MESSAGES.isAdmin],
    ['client', 'has_account', MESSAGES.hasAccount],
  ] as const) {
    const admin = fakeAdmin({ rpcs: { admin_coach_email_status: ok(status) } });
    const res = await setup({ admin }).call(createBody);
    assertEquals(res.status, 409, status);
    assertEquals(await res.json(), { error, message }, status);
    assertEquals(admin.invited.length, 0, status);
  }
});

Deno.test('create: an account created in the meantime is refused as an existing account', async () => {
  const admin = fakeAdmin({
    rpcs: { admin_coach_email_status: ok('new') },
    invite: { data: { user: null }, error: { code: 'email_exists', message: 'exists' } },
  });
  const res = await setup({ admin }).call(createBody);
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, 'has_account');
});

Deno.test('create: if the workspace step fails, the new account is removed again', async () => {
  const admin = fakeAdmin({ rpcs: { admin_coach_email_status: ok('new'), admin_create_coach: fail('XX000') } });
  const res = await setup({ admin }).call(createBody);
  assertEquals(res.status, 500);
  assertEquals(admin.deletedUsers, [NEW_USER]);
});

Deno.test('create: refuses to send an invite without a site URL', async () => {
  const admin = fakeAdmin({ rpcs: { admin_coach_email_status: ok('new') } });
  const res = await setup({ admin, deps: { publicSiteUrl: undefined } }).call(createBody);
  assertEquals(res.status, 500);
  assertEquals(admin.invited.length, 0);
});

// ---------- Delete ----------

function deleteAdmin(o: { deleteUserError?: Record<string, { code?: string; message: string }> } = {}) {
  return fakeAdmin({
    rpcs: { admin_coach_delete_files: [ok(files), ok([])], admin_delete_coach: ok(deleteResult) },
    ...o,
  });
}

Deno.test('delete: files, then the workspace, then the coaches’ accounts, then one email per client', async () => {
  const admin = deleteAdmin();
  const mail = fakeMailer();
  const { call, callerCalls } = setup({ admin, mailer: mail, callerRpcs: { admin_coach_delete_preview: ok(preview) } });
  const res = await call(deleteBody);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    deleted: true,
    workspaceName: 'Luis Bueno Coaching',
    clientsEmailed: 2,
    emailsFailed: 0,
    accountsNotDeleted: 0,
  });
  // The preview runs as the caller (owner + aal2 checked by the database again).
  assertEquals(callerCalls.map((c) => c.name), ['admin_require_owner', 'admin_coach_delete_preview']);
  assertEquals(admin.calls.map((c) => c.name), ['admin_coach_delete_files', 'admin_delete_coach', 'admin_coach_delete_files']);
  assertEquals(admin.calls[0]!.args, { p_workspace_id: WS, p_user_ids: [COACH, STAFF] });
  assertEquals(admin.calls[1]!.args, { p_admin_id: OWNER, p_workspace_id: WS, p_confirm_name: 'Luis Bueno Coaching' });
  assertEquals(admin.removed, [
    { bucket_id: 'meal-photos', name: `${WS}/v/m.webp` },
    { bucket_id: 'avatars', name: `${COACH}/avatar.webp` },
  ]);
  assertEquals(admin.deletedUsers, [COACH, STAFF]);
  assertEquals(mail.sent.map((m) => m.to), ['kay@x.test', 'vic@x.test']);
  assertEquals(mail.sent[0]!.subject, 'Your coach has closed their CalTracker workspace');
  assert(mail.sent[0]!.text.includes('Hi Kay,'));
  assert(mail.sent[0]!.text.includes('Luis Bueno has closed their coaching workspace'));
});

Deno.test('delete: a failed email does not fail the delete; it is counted and the others still go', async () => {
  const admin = deleteAdmin();
  const mail = fakeMailer(['kay@x.test']);
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const res = await setup({ admin, mailer: mail, callerRpcs: { admin_coach_delete_preview: ok(preview) } }).call(deleteBody);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.deleted, true);
    assertEquals(body.clientsEmailed, 1);
    assertEquals(body.emailsFailed, 1);
  } finally {
    console.error = original;
  }
  assertEquals(mail.sent.map((m) => m.to), ['vic@x.test']);
  assert(errors.some((e) => String(e).includes('client email failed')), 'the failure is logged');
  assert(!errors.some((e) => String(e).includes('kay@x.test')), 'the log has no email address');
});

Deno.test('delete: an account that can’t be deleted is counted, and the rest carries on', async () => {
  const admin = deleteAdmin({ deleteUserError: { [COACH]: { code: 'unexpected_failure', message: 'down' } } });
  const original = console.error;
  console.error = () => {};
  try {
    const res = await setup({ admin, callerRpcs: { admin_coach_delete_preview: ok(preview) } }).call(deleteBody);
    assertEquals(res.status, 200);
    assertEquals((await res.json()).accountsNotDeleted, 1);
  } finally {
    console.error = original;
  }
  assertEquals(admin.deletedUsers, [COACH, STAFF]);
});

Deno.test('delete: the typed name must match exactly; nothing is touched otherwise', async () => {
  const admin = deleteAdmin();
  const res = await setup({ admin, callerRpcs: { admin_coach_delete_preview: ok(preview) } }).call({
    ...deleteBody,
    confirmName: 'luis bueno coaching',
  });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: 'confirm_mismatch', message: MESSAGES.confirmMismatch });
  assertEquals(admin.calls.length, 0);
});

Deno.test('delete: a blocker (caller is a member, or an admin coach) is shown and nothing is touched', async () => {
  const admin = deleteAdmin();
  const blocker = 'You can’t delete a workspace you belong to.';
  const res = await setup({ admin, callerRpcs: { admin_coach_delete_preview: ok({ ...preview, blocker }) } }).call(deleteBody);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: 'blocked', message: blocker });
  assertEquals(admin.calls.length, 0);
});

Deno.test('delete: an unknown workspace is 404', async () => {
  const res = await setup({ callerRpcs: { admin_coach_delete_preview: fail('P0002', 'admin: no such workspace') } }).call(
    deleteBody,
  );
  assertEquals(res.status, 404);
});

Deno.test('delete: if the files can’t be removed, the workspace is not deleted (safe to retry)', async () => {
  const admin = deleteAdmin();
  const original = console.error;
  console.error = () => {};
  try {
    const res = await setup({
      admin,
      callerRpcs: { admin_coach_delete_preview: ok(preview) },
      deps: { purgeStorage: () => Promise.reject(new Error('storage down')) },
    }).call(deleteBody);
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, 'retry');
  } finally {
    console.error = original;
  }
  assertEquals(admin.calls.map((c) => c.name), ['admin_coach_delete_files']);
  assertEquals(admin.deletedUsers, []);
});

Deno.test('delete: a refusal from the database is shown as its sentence', async () => {
  const admin = fakeAdmin({
    rpcs: {
      admin_coach_delete_files: ok([]),
      admin_delete_coach: fail('55000', 'admin: A coach in this workspace is a CalTracker admin. Remove them on the Admins page first.'),
    },
  });
  const res = await setup({ admin, callerRpcs: { admin_coach_delete_preview: ok(preview) } }).call(deleteBody);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), {
    error: 'blocked',
    message: 'A coach in this workspace is a CalTracker admin. Remove them on the Admins page first.',
  });
  assertEquals(admin.deletedUsers, []);
});
