// Service-role fixtures for the Maestro flows. LOCAL USE ONLY: never imported by app code.
//   pnpm --filter mobile e2e:invite <email> <name>   create a Demo Coaching invite
//   pnpm --filter mobile e2e:confirm <email>         mark the user's email as confirmed
//   pnpm --filter mobile e2e:cleanup <email>         delete the user and their invites
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts remove <email>   the coach removes this client (Past clients)
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts confirmlink <email>   confirmation link from Mailpit
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts invitelink <email> <name>   invite + its caltracker://invite link
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts assign <email>   the coach assigns "E2E Upper" to this client today
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts cleanup-workouts -   delete every "E2E " workout, program, assignment
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts assign-today <email>   "E2E Log" (squat 3 × 8 @ 60 kg) today
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts cleanup-logs client@demo.local   delete the demo client's logs
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts coach-profile "<business>" "<bio>"   set the demo coach's business name and bio
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts coach-profile-reset -   put them back (Demo Coaching, no bio)
// `serve <port>` exposes the same actions over http://127.0.0.1 for Maestro (see run-e2e.sh).
import { execSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { localToday, splitFullName, type Database, type WorkoutDoc } from '@caltracker/shared';

let statusEnv: string | undefined;
/** A value from `supabase status -o env` (read once). */
function localStatus(name: string): string | undefined {
  statusEnv ??= execSync('supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return statusEnv.match(new RegExp(`^${name}="?([^"\\n]+)"?$`, 'm'))?.[1];
}

function localUrl(): string {
  // Expo's process.env typing is loose (any); cast to the real shape.
  const url = (process.env.SUPABASE_URL as string | undefined) ?? localStatus('API_URL');
  if (!url) throw new Error('Run local Supabase (pnpm db:start) or set SUPABASE_URL.');
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing to run e2e helpers against non-local Supabase host: ${host}`);
  }
  return url;
}

function serviceClient() {
  const url = localUrl();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined) ?? localStatus('SERVICE_ROLE_KEY');
  if (!key) throw new Error('Run local Supabase (pnpm db:start) or set SUPABASE_SERVICE_ROLE_KEY.');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

/** A client signed in as the seed coach with the anon key, so RPCs that check auth.uid() see the coach. */
async function coachClient() {
  const key = (process.env.SUPABASE_ANON_KEY as string | undefined) ?? localStatus('ANON_KEY');
  if (!key) throw new Error('Run local Supabase (pnpm db:start) or set SUPABASE_ANON_KEY.');
  const coach = createClient<Database>(localUrl(), key, { auth: { persistSession: false } });
  const { error } = await coach.auth.signInWithPassword({ email: 'coach@demo.local', password: 'demo-password-123' });
  if (error) throw new Error(`Seed coach sign-in failed (run pnpm db:reset): ${error.message}`);
  return coach;
}

const admin = serviceClient();

async function findUserId(email: string): Promise<string | undefined> {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
}

/** Creates a Demo Coaching invite and returns the app link for it (what "Open in CalTracker" opens). */
export async function inviteLink(email: string, name: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await invite(email, name, createHash('sha256').update(token).digest('hex'));
  return `caltracker://invite/${token}`;
}

export async function invite(email: string, name: string, tokenHash?: string): Promise<void> {
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
    token_hash: tokenHash ?? createHash('sha256').update(randomBytes(32)).digest('hex'),
  });
  if (insErr) throw insErr;
}

export async function confirm(email: string): Promise<void> {
  const id = await findUserId(email);
  if (!id) throw new Error(`No user with email ${email}`);
  const { error } = await admin.auth.admin.updateUserById(id, { email_confirm: true });
  if (error) throw error;
}

/** What the dashboard's Remove does (remove_client needs a signed-in coach, so the helper writes the same rows). */
export async function remove(email: string): Promise<void> {
  const id = await findUserId(email);
  if (!id) throw new Error(`No user with email ${email}`);
  const { data: m, error } = await admin.from('workspace_members').select('workspace_id').eq('user_id', id).eq('role', 'client').single();
  if (error) throw error;
  const { error: pastErr } = await admin.from('past_clients').upsert({ workspace_id: m.workspace_id, user_id: id, email });
  if (pastErr) throw pastErr;
  const { error: delErr } = await admin.from('workspace_members').delete().eq('user_id', id).eq('role', 'client');
  if (delErr) throw delErr;
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

type PlanSet = Omit<WorkoutDoc['blocks'][number]['exercises'][number]['sets'][number], 'id'>;

const NO_EXTRA = { targetDurationS: null, targetDistanceM: null, note: null };
const squatSet = (restSeconds: number): PlanSet => ({
  ...NO_EXTRA,
  setType: 'normal',
  targetRepsMin: 8,
  targetRepsMax: 8,
  targetWeightKg: 60,
  toFailure: false,
  restSeconds,
});

/**
 * What the coach does on the dashboard: save a library workout `name` of Barbell Squat with these sets, put it on
 * Day 1 of a 1-week program "E2E Program", and assign that to the client starting today in this Mac's time zone
 * (the simulator's). Clears earlier E2E rows first, so it can be rerun.
 */
async function assignWorkout(email: string, name: string, sets: PlanSet[]): Promise<void> {
  await cleanupWorkouts();
  const clientId = await findUserId(email);
  if (!clientId) throw new Error(`No user with email ${email}`);
  const coach = await coachClient();
  try {
    const { data: ws, error: wsErr } = await coach.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
    if (wsErr) throw wsErr;
    const { data: squat, error: exErr } = await coach
      .from('exercises')
      .select('id, name, tracking_type')
      .eq('source', 'builtin')
      .eq('name', 'Barbell Squat')
      .limit(1)
      .single();
    if (exErr) throw new Error(`Barbell Squat not found (run pnpm import:exercises): ${exErr.message}`);

    const doc: WorkoutDoc = {
      id: randomUUID(),
      name,
      notes: null,
      blocks: [
        {
          id: randomUUID(),
          kind: 'straight',
          exercises: [
            {
              id: randomUUID(),
              exerciseId: squat.id,
              exerciseName: squat.name,
              trackingType: squat.tracking_type,
              note: null,
              sets: sets.map((s) => ({ ...s, id: randomUUID() })),
            },
          ],
        },
      ],
    };
    const { data: workoutId, error: saveErr } = await coach.rpc('save_workout', { p_workspace_id: ws.id, p_doc: doc });
    if (saveErr) throw saveErr;

    const programId = randomUUID();
    const { error: progErr } = await coach.from('programs').insert({ id: programId, workspace_id: ws.id, name: 'E2E Program', weeks: 1 });
    if (progErr) throw progErr;
    // workspace_id is copied from the program by a trigger (and isn't insertable); the generated type still lists it.
    type SlotInsert = Database['public']['Tables']['program_workouts']['Insert'];
    const slot = { program_id: programId, week: 1, day: 1, position: 0, workout_id: workoutId } as Omit<
      SlotInsert,
      'workspace_id'
    > as SlotInsert;
    const { error: slotErr } = await coach.from('program_workouts').insert(slot);
    if (slotErr) throw slotErr;

    const { error: assignErr } = await coach.rpc('assign_program', {
      p_assignment_id: randomUUID(),
      p_program_id: programId,
      p_client_id: clientId,
      p_start_date: localToday(),
    });
    if (assignErr) throw assignErr;
  } finally {
    await coach.auth.signOut();
  }
}

/** "E2E Upper": Barbell Squat, 8 reps @ 60 kg, then a drop to failure. */
export function assign(email: string): Promise<void> {
  return assignWorkout(email, 'E2E Upper', [
    squatSet(90),
    { ...NO_EXTRA, setType: 'drop', targetRepsMin: null, targetRepsMax: null, targetWeightKg: null, toFailure: true, restSeconds: 0 },
  ]);
}

/** "E2E Log": Barbell Squat 3 × 8 @ 60 kg with 90 s rests, for the logging flows. Starts with no logs left over. */
export async function assignToday(email: string): Promise<void> {
  await cleanupLogs(email);
  await assignWorkout(email, 'E2E Log', [squatSet(90), squatSet(90), squatSet(90)]);
}

/** The only account whose logs the flows may delete. */
const DEMO_CLIENT = 'client@demo.local';

/** Deletes every workout log of the seed demo client (blocks, sets and comments cascade). Nobody else's. */
export async function cleanupLogs(email: string): Promise<void> {
  if (email.toLowerCase() !== DEMO_CLIENT) throw new Error(`cleanup-logs only clears ${DEMO_CLIENT}`);
  const id = await findUserId(DEMO_CLIENT);
  if (!id) throw new Error(`Seed client ${DEMO_CLIENT} not found (run pnpm db:reset).`);
  const { error } = await admin.from('workout_logs').delete().eq('client_id', id);
  if (error) throw error;
}

/** Deletes every workout, program and assignment whose name starts with "E2E " (client copies first). */
export async function cleanupWorkouts(): Promise<void> {
  const steps = [
    () => admin.from('workouts').delete().like('name', 'E2E %').not('client_id', 'is', null),
    () => admin.from('program_assignments').delete().like('program_name', 'E2E %'),
    () => admin.from('programs').delete().like('name', 'E2E %'),
    () => admin.from('workouts').delete().like('name', 'E2E %'),
  ];
  for (const step of steps) {
    const { error } = await step();
    if (error) throw error;
  }
}

const DEMO_BUSINESS = 'Demo Coaching';

/** What the coach's profile page saves: the business name and bio (service role writes the same rows). */
export async function setCoachProfile(business: string, bio: string): Promise<void> {
  const coachId = await findUserId('coach@demo.local');
  if (!coachId) throw new Error('Seed coach coach@demo.local not found (run pnpm db:reset).');
  const { data: m, error } = await admin.from('workspace_members').select('workspace_id').eq('user_id', coachId).eq('role', 'owner').single();
  if (error) throw error;
  const { error: wsErr } = await admin.from('workspaces').update({ name: business }).eq('id', m.workspace_id);
  if (wsErr) throw wsErr;
  const { error: bioErr } = await admin.from('profiles').update({ bio }).eq('id', coachId);
  if (bioErr) throw bioErr;
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
  if (action === 'invitelink') return inviteLink(email, name);
  if (action === 'invite') await invite(email, name);
  else if (action === 'confirm') await confirm(email);
  else if (action === 'cleanup') await cleanup(email);
  else if (action === 'remove') await remove(email);
  else if (action === 'assign') await assign(email);
  else if (action === 'cleanup-workouts') await cleanupWorkouts();
  else if (action === 'assign-today') await assignToday(email);
  else if (action === 'cleanup-logs') await cleanupLogs(email);
  // For these two the "email" is the business name and the "name" is the bio.
  else if (action === 'coach-profile') await setCoachProfile(email, name);
  else if (action === 'coach-profile-reset') await setCoachProfile(DEMO_BUSINESS, '');
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
