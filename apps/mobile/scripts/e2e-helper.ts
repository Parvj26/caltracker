// Service-role fixtures for the Maestro flows. LOCAL USE ONLY: never imported by app code.
//   pnpm --filter mobile e2e:invite <email> <name>   create a Demo Coaching invite
//   pnpm --filter mobile e2e:confirm <email>         mark the user's email as confirmed
//   pnpm --filter mobile e2e:cleanup <email>         delete the user and their invites
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts confirmlink <email>   confirmation link from Mailpit
// `serve <port>` exposes the same actions over http://127.0.0.1 for Maestro (see run-e2e.sh).
import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { splitFullName, type Database } from '@caltracker/shared';

function serviceClient() {
  // Expo's process.env typing is loose (any); cast to the real shape.
  let url = process.env.SUPABASE_URL as string | undefined;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
  if (!url || !key) {
    const out = execSync('supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const get = (name: string) => out.match(new RegExp(`^${name}="?([^"\\n]+)"?$`, 'm'))?.[1];
    url = get('API_URL');
    key = get('SERVICE_ROLE_KEY');
  }
  if (!url || !key) throw new Error('Run local Supabase (pnpm db:start) or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing to run service-role helpers against non-local Supabase host: ${host}`);
  }
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

const admin = serviceClient();

async function findUserId(email: string): Promise<string | undefined> {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
}

export async function invite(email: string, name: string): Promise<void> {
  const { data: ws, error } = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (error) throw error;
  const coachId = await findUserId('coach@demo.local');
  if (!coachId) throw new Error('Seed coach coach@demo.local not found (run pnpm db:reset).');
  await admin.from('client_invites').delete().eq('workspace_id', ws.id).eq('email', email);
  const { error: insErr } = await admin.from('client_invites').insert({
    workspace_id: ws.id,
    email,
    first_name: splitFullName(name).firstName,
    last_name: splitFullName(name).lastName,
    created_by: coachId,
    token_hash: createHash('sha256').update(randomBytes(32)).digest('hex'),
  });
  if (insErr) throw insErr;
}

export async function confirm(email: string): Promise<void> {
  const id = await findUserId(email);
  if (!id) throw new Error(`No user with email ${email}`);
  const { error } = await admin.auth.admin.updateUserById(id, { email_confirm: true });
  if (error) throw error;
}

export async function cleanup(email: string): Promise<void> {
  // Invites first: accepted_by references auth.users without cascade. Memberships cascade from the user.
  const { error } = await admin.from('client_invites').delete().eq('email', email);
  if (error) throw error;
  const id = await findUserId(email);
  if (id) {
    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) throw delErr;
  }
}

// Finds the newest confirmation email for `email` in Mailpit (local mail catcher) and returns its verify link.
export async function confirmLink(email: string): Promise<string> {
  const base = (process.env.MAILPIT_URL as string | undefined) ?? 'http://127.0.0.1:54324';
  const search = (await (await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as {
    messages: { ID: string }[];
  };
  for (const m of search.messages) {
    const msg = (await (await fetch(`${base}/api/v1/message/${m.ID}`)).json()) as { Text: string; HTML: string };
    const link = /https?:\/\/[^\s"<>]*\/auth\/v1\/verify\?[^\s"<>]+/.exec(`${msg.Text}\n${msg.HTML}`)?.[0];
    if (link) return link.replace(/&amp;/g, '&');
  }
  throw new Error(`No confirmation email found for ${email}`);
}

async function run(action: string, email: string, name: string): Promise<string | void> {
  if (action === 'confirmlink') return confirmLink(email);
  if (action === 'invite') await invite(email, name);
  else if (action === 'confirm') await confirm(email);
  else if (action === 'cleanup') await cleanup(email);
  else throw new Error(`Unknown action ${action}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'serve') {
  const port = Number(args[0] ?? 54399);
  createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const action = u.pathname.slice(1);
    if (action === 'health') return void res.writeHead(200).end('ok');
    run(action, u.searchParams.get('email') ?? '', u.searchParams.get('name') ?? '')
      .then((out) => res.writeHead(200).end(out ?? 'ok'))
      .catch((e: unknown) => res.writeHead(500).end(e instanceof Error ? e.message : String(e)));
  }).listen(port, '127.0.0.1', () => console.log(`e2e helper listening on ${port}`));
} else if (cmd) {
  const [email, name] = args;
  if (!email) throw new Error(`Usage: e2e-helper.ts ${cmd} <email> [name]`);
  run(cmd, email, name ?? 'E2E Client').then(
    (out) => console.log(out ?? `${cmd} ok: ${email}`),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
