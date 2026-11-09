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
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts assign-today-mixed <email>   "E2E Mixed" (warm-up, superset, drops) today
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts assign-today-sections <email> "E2E Sections" (sections, uneven superset, pick-one) today
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts cleanup-logs client@demo.local   delete the demo client's logs
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts assign-today-progression client@demo.local   "E2E Progress" (squat 3 × 8–10, no weight) today, after a finished 3 × 10 @ 60 kg yesterday
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts coach-profile "<business>" "<bio>"   set the demo coach's business name and bio
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts coach-profile-reset -   put them back (Demo Coaching, no bio)
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts coach-message client@demo.local "text"   the coach sends a chat message
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts assert-reply client@demo.local "text"   fails unless the client sent it
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts assert-read client@demo.local   fails unless the client has read the chat
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts cleanup-messages client@demo.local   delete the demo client's chat
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts seed-scans client@demo.local   two coach scans (weight 82 kg, 80 kg) and a goal
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts cleanup-scans client@demo.local   delete the demo client's scans and goal
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts seed-food-targets client@demo.local   targets 2,000 kcal and 150 g protein
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts cleanup-food client@demo.local   delete the demo client's meals and targets
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts seed-coach-meals client@demo.local   the seed coach shares "Protein oats" (450 kcal, 35/52/11 g)
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts cleanup-coach-meals client@demo.local   remove the Demo Coaching shared meals
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts community-coach-post "<text>"   the demo coach posts in the community
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts community-buddy-post "<text>"   a second demo client (buddy) posts
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts community-cleanup -   delete "E2E " posts, reports, blocks and the buddy
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts coach-take-over client@demo.local   the seed coach takes over their workout
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts coach-log-set client@demo.local   the coach ticks set 2 (10 reps @ 60 kg)
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts coach-hand-back client@demo.local   the coach hands it back
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts coach-idle client@demo.local   the coach's last activity 21 min ago
//   pnpm --filter mobile exec tsx scripts/e2e-helper.ts coach-finish client@demo.local   the coach ticks the rest and finishes
// `serve <port>` exposes the same actions over http://127.0.0.1 for Maestro (see run-e2e.sh).
import { execSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import {
  LOG_TREE_SELECT,
  addDays,
  completeSet,
  finishLog,
  localToday,
  logRowToDoc,
  splitFullName,
  updateActual,
  type Database,
  type LogTreeRow,
  type WorkoutDoc,
  type WorkoutLogDoc,
} from '@caltracker/shared';

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

type PlanBlock = {
  kind: 'straight' | 'superset' | 'choice';
  /** The section heading the block sits under (consecutive blocks with the same name share one section). */
  section?: string;
  exercises: Array<{ name: string; sets: PlanSet[]; substitutes?: Array<{ name: string; sets: PlanSet[] }> }>;
};

/**
 * What the coach does on the dashboard: save a library workout `name` with these blocks (built-in exercises looked
 * up by name), put it on Day 1 of a 1-week program "E2E Program", and assign that to the client starting today in
 * this Mac's time zone (the simulator's). Clears earlier E2E rows first, so it can be rerun.
 */
async function assignWorkout(email: string, name: string, blocks: PlanBlock[]): Promise<void> {
  await cleanupWorkouts();
  const clientId = await findUserId(email);
  if (!clientId) throw new Error(`No user with email ${email}`);
  const coach = await coachClient();
  try {
    const { data: ws, error: wsErr } = await coach.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
    if (wsErr) throw wsErr;
    const names = [...new Set(blocks.flatMap((b) => b.exercises.flatMap((e) => [e.name, ...(e.substitutes ?? []).map((x) => x.name)])))];
    const { data: found, error: exErr } = await coach
      .from('exercises')
      .select('id, name, tracking_type')
      .eq('source', 'builtin')
      .in('name', names);
    if (exErr) throw exErr;
    const byName = new Map(found.map((e) => [e.name, e]));
    const missing = names.filter((n) => !byName.has(n));
    if (missing.length > 0) throw new Error(`${missing.join(', ')} not found (run pnpm import:exercises)`);

    const sectionIds = new Map<string, string>();
    for (const b of blocks) if (b.section && !sectionIds.has(b.section)) sectionIds.set(b.section, randomUUID());
    const doc: WorkoutDoc = {
      id: randomUUID(),
      name,
      notes: null,
      sections: [...sectionIds].map(([sectionName, id]) => ({ id, name: sectionName })),
      blocks: blocks.map((b) => ({
        id: randomUUID(),
        sectionId: b.section ? (sectionIds.get(b.section) ?? null) : null,
        kind: b.kind,
        exercises: b.exercises.map((e) => {
          const ex = byName.get(e.name)!;
          return {
            id: randomUUID(),
            exerciseId: ex.id,
            exerciseName: ex.name,
            trackingType: ex.tracking_type,
            note: null,
            sets: e.sets.map((s) => ({ ...s, id: randomUUID() })),
            substitutes: (e.substitutes ?? []).map((sub) => {
              const subEx = byName.get(sub.name)!;
              return {
                id: randomUUID(),
                exerciseId: subEx.id,
                exerciseName: subEx.name,
                trackingType: subEx.tracking_type,
                note: null,
                sets: sub.sets.map((x) => ({ ...x, id: randomUUID() })),
              };
            }),
          };
        }),
      })),
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

/** One straight block of Barbell Squat. */
const squat = (sets: PlanSet[]): PlanBlock[] => [{ kind: 'straight', exercises: [{ name: 'Barbell Squat', sets }] }];

/** A set with reps (and optionally kg) targets. */
const plan = (setType: PlanSet['setType'], reps: number | null, kg: number | null, restSeconds: number, toFailure = false): PlanSet => ({
  ...NO_EXTRA,
  setType,
  targetRepsMin: reps,
  targetRepsMax: reps,
  targetWeightKg: kg,
  toFailure,
  restSeconds,
});

/** "E2E Upper": Barbell Squat, 8 reps @ 60 kg, then a drop to failure. */
export function assign(email: string): Promise<void> {
  return assignWorkout(email, 'E2E Upper', squat([squatSet(90), plan('drop', null, null, 0, true)]));
}

/** "E2E Log": Barbell Squat 3 × 8 @ 60 kg with 90 s rests, for the logging flows. Starts with no logs left over. */
export async function assignToday(email: string): Promise<void> {
  await cleanupLogs(email);
  await assignWorkout(email, 'E2E Log', squat([squatSet(90), squatSet(90), squatSet(90)]));
}

/**
 * "E2E Progress" today, for auto-progression: Barbell Squat 3 × 8–10 with no weight (its new program has Auto
 * progression on), after a finished log yesterday of 3 × 10 @ 60 kg, so the phone suggests 60 kg + 5 kg (lower body).
 */
export async function assignTodayProgression(email: string): Promise<void> {
  await cleanupLogs(email);
  const range = (): PlanSet => ({ ...plan('normal', 8, null, 90), targetRepsMax: 10 });
  await assignWorkout(email, 'E2E Progress', squat([range(), range(), range()]));
  const clientId = (await findUserId(email))!;
  const { data: m, error: mErr } = await admin.from('workspace_members').select('workspace_id').eq('user_id', clientId).eq('role', 'client').single();
  if (mErr) throw mErr;
  const { data: ex, error: exErr } = await admin.from('exercises').select('id').eq('source', 'builtin').eq('name', 'Barbell Squat').single();
  if (exErr) throw exErr;
  const finished = new Date(Date.now() - 24 * 3600_000).toISOString();
  const logId = randomUUID();
  const { error: logErr } = await admin.from('workout_logs').insert({
    id: logId,
    workspace_id: m.workspace_id,
    client_id: clientId,
    name: 'E2E Yesterday',
    status: 'completed',
    started_at: finished,
    finished_at: finished,
    last_activity_at: finished,
  });
  if (logErr) throw logErr;
  // workspace_id and client_id of the children are filled from the log by triggers.
  type BlockInsert = Database['public']['Tables']['log_blocks']['Insert'];
  type ExerciseInsert = Database['public']['Tables']['log_exercises']['Insert'];
  type SetInsert = Database['public']['Tables']['log_sets']['Insert'];
  const blockId = randomUUID();
  const { error: bErr } = await admin.from('log_blocks').insert({ id: blockId, log_id: logId, position: 0, kind: 'straight' } as BlockInsert);
  if (bErr) throw bErr;
  const leId = randomUUID();
  const { error: eErr } = await admin
    .from('log_exercises')
    .insert({ id: leId, block_id: blockId, log_id: logId, position: 0, exercise_id: ex.id } as ExerciseInsert);
  if (eErr) throw eErr;
  const sets = [0, 1, 2].map(
    (position) =>
      ({
        log_exercise_id: leId,
        log_id: logId,
        position,
        set_type: 'normal',
        target_reps_min: 8,
        target_reps_max: 10,
        actual_reps: 10,
        actual_weight_kg: 60,
        completed_at: finished,
      }) as SetInsert,
  );
  const { error: sErr } = await admin.from('log_sets').insert(sets);
  if (sErr) throw sErr;
}

/**
 * "E2E Mixed" today, for log-flow: (1) Barbell Squat W 20 kg × 10 rest 60, then 2 × 8 @ 60 kg rest 90;
 * (2) superset Pullups + Pushups, 2 rounds of 8 reps, rests A1 0 / A2 60; (3) Dumbbell Bicep Curl 2 × 12 @ 10 kg
 * rest 60, the second followed by drops of 7.5 kg and 5 kg to failure. Starts with no logs left over.
 */
export async function assignTodayMixed(email: string): Promise<void> {
  await cleanupLogs(email);
  const round = (rest: number) => [plan('normal', 8, null, rest), plan('normal', 8, null, rest)];
  await assignWorkout(email, 'E2E Mixed', [
    ...squat([plan('warmup', 10, 20, 60), squatSet(90), squatSet(90)]),
    {
      kind: 'superset',
      exercises: [
        { name: 'Pullups', sets: round(0) },
        { name: 'Pushups', sets: round(60) },
      ],
    },
    {
      kind: 'straight',
      exercises: [
        {
          name: 'Dumbbell Bicep Curl',
          sets: [plan('normal', 12, 10, 60), plan('normal', 12, 10, 60), plan('drop', null, 7.5, 0, true), plan('drop', null, 5, 0, true)],
        },
      ],
    },
  ]);
}

/**
 * "E2E Sections" today, for log-sections: section "Upper" holds an uneven superset, Pullups 3 × 8 (no rest) +
 * Pushups 2 × 8 (1:00 rest), so round 3 is Pullups alone and rests the block's 1:00; section "Finisher" is a
 * pick-one group of Barbell Squat 2 × 8 @ 60 kg or Dumbbell Bicep Curl 2 × 12 @ 10 kg. Starts with no logs left over.
 */
export async function assignTodaySections(email: string): Promise<void> {
  await cleanupLogs(email);
  const reps = (n: number, rest: number) => Array.from({ length: n }, () => plan('normal', 8, null, rest));
  await assignWorkout(email, 'E2E Sections', [
    {
      kind: 'superset',
      section: 'Upper',
      exercises: [
        { name: 'Pullups', sets: reps(3, 0) },
        { name: 'Pushups', sets: reps(2, 60) },
      ],
    },
    {
      kind: 'choice',
      section: 'Finisher',
      exercises: [
        { name: 'Barbell Squat', sets: [squatSet(60), squatSet(60)] },
        { name: 'Dumbbell Bicep Curl', sets: [plan('normal', 12, 10, 60), plan('normal', 12, 10, 60)] },
      ],
    },
  ]);
}

const LB = 0.45359237;
const lb = (n: number) => Math.round(n * LB * 1000) / 1000;

/**
 * "E2E Upper/Core" today, the simple-logging mock-ups: Warm-Up [Arm Circles 1 × 0:30]; Resistance Training
 * [superset 1: Dumbbell Bench Press 35/45/55/30 lb + Dumbbell Alternate Bicep Curl 3 sets (uneven), 1:00 round rest;
 * superset 2: Wide-Grip Lat Pulldown 85/115 lb (substitute Machine Assisted Pull Up 2 × 10 @ 40 lb) + Triceps
 * Pushdown 70/80 lb; Triceps Pushdown - Rope Attachment W 20 lb × 10, 40 lb × 12, drop 30 lb, drop 20 lb to
 * failure]; Finisher [pick one: Overhead Slam 2 × 12 @ 15 lb, Farmer's Walk, Medicine Ball Scoop Throw].
 */
export async function assignTodayMockup(email: string): Promise<void> {
  await cleanupLogs(email);
  const w = (reps: number, pounds: number, rest: number) => plan('normal', reps, lb(pounds), rest);
  await assignWorkout(email, 'E2E Upper/Core', [
    {
      kind: 'straight',
      section: 'Warm-Up',
      exercises: [{ name: 'Arm Circles', sets: [{ ...plan('normal', null, null, 0), targetDurationS: 30 }] }],
    },
    {
      kind: 'superset',
      section: 'Resistance Training',
      exercises: [
        { name: 'Dumbbell Bench Press', sets: [w(12, 35, 0), w(12, 45, 0), w(10, 55, 0), w(5, 30, 0)] },
        { name: 'Dumbbell Alternate Bicep Curl', sets: [w(12, 20, 60), w(12, 25, 60), w(12, 25, 60)] },
      ],
    },
    {
      kind: 'superset',
      section: 'Resistance Training',
      exercises: [
        {
          name: 'Wide-Grip Lat Pulldown',
          sets: [w(12, 85, 0), w(12, 115, 0)],
          substitutes: [{ name: 'Machine Assisted Pull Up', sets: [w(10, 40, 0), w(10, 40, 0)] }],
        },
        { name: 'Triceps Pushdown', sets: [w(12, 70, 60), w(12, 80, 60)] },
      ],
    },
    {
      kind: 'straight',
      section: 'Resistance Training',
      exercises: [
        {
          name: 'Triceps Pushdown - Rope Attachment',
          sets: [plan('warmup', 10, lb(20), 60), w(12, 40, 60), plan('drop', null, lb(30), 0), plan('drop', null, lb(20), 0, true)],
        },
      ],
    },
    {
      kind: 'choice',
      section: 'Finisher',
      exercises: [
        { name: 'Overhead Slam', sets: [w(12, 15, 30), w(12, 15, 30)] },
        { name: "Farmer's Walk", sets: [{ ...plan('normal', null, null, 60), targetDistanceM: 40 }, { ...plan('normal', null, null, 60), targetDistanceM: 40 }] },
        { name: 'Medicine Ball Scoop Throw', sets: [w(10, 10, 30), w(10, 10, 30)] },
      ],
    },
  ]);
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
  // What the logs earned goes too (awards go with their log), so every flow starts with an empty zoo book.
  for (const table of ['sticker_awards', 'personal_records', 'client_stats'] as const) {
    const { error: awardError } = await admin.from(table).delete().eq('client_id', id);
    if (awardError) throw awardError;
  }
}

/** The demo client's conversation id and the seed coach's id (messages are inserted as the coach, with the service role). */
async function demoChat(email: string): Promise<{ conversationId: string | null; clientId: string; coachId: string }> {
  if (email.toLowerCase() !== DEMO_CLIENT) throw new Error(`chat helpers only touch ${DEMO_CLIENT}`);
  const clientId = await findUserId(DEMO_CLIENT);
  const coachId = await findUserId('coach@demo.local');
  if (!clientId || !coachId) throw new Error('Seed users not found (run pnpm db:reset).');
  const { data, error } = await admin.from('conversations').select('id').eq('client_id', clientId).maybeSingle();
  if (error) throw error;
  return { conversationId: data?.id ?? null, clientId, coachId };
}

/** The seed coach writes to the demo client (creates the conversation if needed). */
export async function coachMessage(email: string, body: string): Promise<void> {
  const { conversationId, clientId, coachId } = await demoChat(email);
  const { data: ws, error: wsErr } = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (wsErr) throw wsErr;
  let id = conversationId;
  if (!id) {
    const made = await admin.from('conversations').insert({ workspace_id: ws.id, client_id: clientId }).select('id').single();
    if (made.error) throw made.error;
    id = made.data.id;
  }
  // A trigger copies workspace_id from the conversation; the generated type just requires a value.
  const { error } = await admin.from('messages').insert({ conversation_id: id, workspace_id: ws.id, sender_id: coachId, body });
  if (error) throw error;
}

/** Throws unless the demo client has sent a message with exactly this text. */
export async function assertReply(email: string, body: string): Promise<void> {
  const { conversationId, clientId } = await demoChat(email);
  if (!conversationId) throw new Error('No conversation');
  const { data, error } = await admin.from('messages').select('id').eq('conversation_id', conversationId).eq('sender_id', clientId).eq('body', body);
  if (error) throw error;
  if (data.length !== 1) throw new Error(`Expected exactly one client message "${body}", found ${data.length}`);
}

/** Throws unless the demo client has read every coach message. */
export async function assertRead(email: string): Promise<void> {
  const { conversationId, clientId, coachId } = await demoChat(email);
  if (!conversationId) throw new Error('No conversation');
  const [{ data: reads, error: e1 }, { data: last, error: e2 }] = await Promise.all([
    admin.from('conversation_reads').select('last_read_at').eq('conversation_id', conversationId).eq('user_id', clientId).maybeSingle(),
    admin.from('messages').select('created_at').eq('conversation_id', conversationId).eq('sender_id', coachId).order('created_at', { ascending: false }).limit(1),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const newest = last[0]?.created_at;
  if (!reads || (newest && Date.parse(reads.last_read_at) < Date.parse(newest))) throw new Error('The client has unread coach messages');
}

/** Deletes the demo client's conversation (messages and reads cascade). Nobody else's. */
export async function cleanupMessages(email: string): Promise<void> {
  const { conversationId } = await demoChat(email);
  if (!conversationId) return;
  const { error } = await admin.from('conversations').delete().eq('id', conversationId);
  if (error) throw error;
}

/**
 * The workout note of the client's latest finished log (the finish sheet writes "Felt: …" there), lines joined by
 * " | ". Waits up to 15 s for the phone's upload.
 */
export async function logNotes(email: string): Promise<string> {
  const id = await findUserId(email);
  if (!id) throw new Error(`No user with email ${email}`);
  for (let i = 0; i < 30; i += 1) {
    const { data, error } = await admin
      .from('workout_logs')
      .select('notes')
      .eq('client_id', id)
      .eq('status', 'completed')
      .order('started_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    if (data[0]) return (data[0].notes ?? '').split('\n').join(' | ');
    await new Promise((r) => setTimeout(r, 500));
  }
  return '';
}

// ---- Coach session logging (docs/superpowers/specs/2026-11-06-coach-session-logging-design.md) ----
// The seed coach drives the demo client's in-progress workout through the same RPCs as the coach website
// (take_over_workout_log, coach_save_workout_log, hand_back_workout_log), signed in with the anon key.

/** The demo client's id and their in-progress log, waiting up to 20 s for the phone's upload. */
async function inProgressLog(email: string): Promise<{ clientId: string; logId: string }> {
  if (email.toLowerCase() !== DEMO_CLIENT) throw new Error(`coach session helpers only drive ${DEMO_CLIENT}`);
  const clientId = await findUserId(DEMO_CLIENT);
  if (!clientId) throw new Error(`Seed client ${DEMO_CLIENT} not found (run pnpm db:reset).`);
  for (let i = 0; i < 40; i += 1) {
    const { data, error } = await admin.from('workout_logs').select('id').eq('client_id', clientId).eq('status', 'in_progress').limit(1);
    if (error) throw error;
    if (data[0]) return { clientId, logId: data[0].id };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${DEMO_CLIENT} has no workout in progress`);
}

type CoachClient = Awaited<ReturnType<typeof coachClient>>;

/** The coach's copy of the log (what the website's session page loads). */
async function coachDoc(coach: CoachClient, logId: string): Promise<WorkoutLogDoc> {
  const { data, error } = await coach.from('workout_logs').select(LOG_TREE_SELECT).eq('id', logId).single();
  if (error) throw error;
  // The select string is built by concatenation, so supabase-js cannot infer its shape; LogTreeRow describes it.
  return logRowToDoc(data as unknown as LogTreeRow);
}

async function coachSave(coach: CoachClient, clientId: string, doc: WorkoutLogDoc): Promise<void> {
  const { data, error } = await coach.rpc('coach_save_workout_log', {
    p_client_id: clientId,
    p_doc: doc as unknown as Database['public']['Functions']['coach_save_workout_log']['Args']['p_doc'],
  });
  if (error) throw error;
  if ((data as { applied?: boolean } | null)?.applied !== true) throw new Error(`Coach save not applied: ${JSON.stringify(data)}`);
}

/** Takes over once the phone's ticked set has reached the server (waits up to 20 s), as a coach in the room would. */
export async function coachTakeOver(email: string): Promise<void> {
  const { logId } = await inProgressLog(email);
  for (let i = 0; i < 40; i += 1) {
    const { data, error } = await admin.from('workout_logs').select(LOG_TREE_SELECT).eq('id', logId).single();
    if (error) throw error;
    const doc = logRowToDoc(data as unknown as LogTreeRow);
    if (doc.blocks.some((b) => b.exercises.some((e) => e.sets.some((x) => x.completedAt !== null)))) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const coach = await coachClient();
  const { error } = await coach.rpc('take_over_workout_log', { p_log_id: logId });
  if (error) throw error;
}

/** The coach ticks the second set of the first exercise with 10 reps at 60 kg. */
export async function coachLogSet(email: string): Promise<void> {
  const { clientId, logId } = await inProgressLog(email);
  const coach = await coachClient();
  const doc = await coachDoc(coach, logId);
  const set = doc.blocks[0]?.exercises[0]?.sets[1];
  if (!set) throw new Error('The log has no second set');
  const now = new Date().toISOString();
  await coachSave(coach, clientId, completeSet(updateActual(doc, set.id, { actualReps: 10, actualWeightKg: 60 }), set.id, now));
}

export async function coachHandBack(email: string): Promise<void> {
  const { logId } = await inProgressLog(email);
  const coach = await coachClient();
  const { error } = await coach.rpc('hand_back_workout_log', { p_log_id: logId });
  if (error) throw error;
}

/** As if the coach stopped 21 minutes ago (activity is the server's clock, so the row is backdated). */
export async function coachIdle(email: string): Promise<void> {
  const { logId } = await inProgressLog(email);
  const { error } = await admin
    .from('workout_logs')
    .update({ last_activity_at: new Date(Date.now() - 21 * 60_000).toISOString() })
    .eq('id', logId);
  if (error) throw error;
}

/** The coach ticks every open set with its planned numbers and finishes the session. */
export async function coachFinish(email: string): Promise<void> {
  const { clientId, logId } = await inProgressLog(email);
  const coach = await coachClient();
  let doc = await coachDoc(coach, logId);
  const now = new Date().toISOString();
  for (const set of doc.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets))) {
    if (set.completedAt !== null) continue;
    doc = updateActual(doc, set.id, { actualReps: set.actualReps ?? set.target.repsMin, actualWeightKg: set.actualWeightKg ?? set.target.weightKg });
    doc = completeSet(doc, set.id, now);
  }
  const finished = finishLog(doc, now);
  if (finished.status !== 'completed') throw new Error('The coach could not finish the log');
  await coachSave(coach, clientId, finished);
}

/** Deletes every body scan (values cascade) and the goal of the seed demo client. Nobody else's. */
export async function cleanupScans(email: string): Promise<void> {
  if (email.toLowerCase() !== DEMO_CLIENT) throw new Error(`cleanup-scans only clears ${DEMO_CLIENT}`);
  const id = await findUserId(DEMO_CLIENT);
  if (!id) throw new Error(`Seed client ${DEMO_CLIENT} not found (run pnpm db:reset).`);
  const { error } = await admin.from('body_measurements').delete().eq('client_id', id);
  if (error) throw error;
  const goal = await admin.from('client_goals').delete().eq('client_id', id);
  if (goal.error) throw goal.error;
}

/**
 * Two coach-entered scans for the demo client (34 and 3 days ago): weight 82 kg then 80 kg, body fat 20% then 19%,
 * skeletal muscle 35 kg then 36 kg; and the coach's goal "Run a 5K under 30 minutes", 49 days away. Starts clean.
 */
export async function seedScans(email: string): Promise<void> {
  await cleanupScans(email);
  const clientId = await findUserId(email);
  if (!clientId) throw new Error(`User ${email} not found`);
  // The flow types pounds, so make that explicit rather than rely on the default.
  const { error: unitsErr } = await admin.from('profiles').update({ units: 'lb' }).eq('id', clientId);
  if (unitsErr) throw unitsErr;
  const { data: ws, error: wsErr } = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (wsErr) throw wsErr;
  const coach = await coachClient();
  try {
    for (const [daysAgo, kg, fat, smm] of [[34, 82, 20, 35], [3, 80, 19, 36]] as const) {
      const measuredOn = addDays(localToday(), -daysAgo);
      const { error } = await coach.rpc('save_body_measurement', {
        p: { workspace_id: ws.id, client_id: clientId, measured_on: measuredOn, values: { weight_kg: kg, body_fat_pct: fat, smm_kg: smm } },
      });
      if (error) throw error;
    }
    const { error: goalErr } = await coach
      .from('client_goals')
      .insert({ workspace_id: ws.id, client_id: clientId, goal: 'Run a 5K under 30 minutes', target_date: addDays(localToday(), 49) });
    if (goalErr) throw goalErr;
  } finally {
    await coach.auth.signOut();
  }
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

const BUDDY_EMAIL = 'community-buddy@demo.local';

/** The demo workspace and its community. */
async function demoCommunity(): Promise<{ workspaceId: string; communityId: string; coachId: string }> {
  const coachId = await findUserId('coach@demo.local');
  if (!coachId) throw new Error('Seed coach coach@demo.local not found (run pnpm db:reset).');
  const m = await admin.from('workspace_members').select('workspace_id').eq('user_id', coachId).eq('role', 'owner').single();
  if (m.error) throw m.error;
  const c = await admin.from('communities').select('id').eq('workspace_id', m.data.workspace_id).eq('is_default', true).single();
  if (c.error) throw c.error;
  return { workspaceId: m.data.workspace_id, communityId: c.data.id, coachId };
}

/** A post written straight into the table (the service role); the coach-post notification trigger still fires. */
async function communityPost(authorId: string, body: string): Promise<void> {
  const { workspaceId, communityId } = await demoCommunity();
  const { error } = await admin.from('community_posts').insert({ community_id: communityId, workspace_id: workspaceId, author_id: authorId, body });
  if (error) throw error;
}

/** A second client in the demo workspace ("Buddy Demo"), created on first use. */
async function buddyId(): Promise<string> {
  const existing = await findUserId(BUDDY_EMAIL);
  if (existing) return existing;
  const { workspaceId } = await demoCommunity();
  const u = await admin.auth.admin.createUser({
    email: BUDDY_EMAIL,
    password: randomBytes(16).toString('hex'),
    email_confirm: true,
    user_metadata: { first_name: 'Buddy', last_name: 'Demo' },
  });
  if (u.error) throw u.error;
  const m = await admin.from('workspace_members').insert({ workspace_id: workspaceId, user_id: u.data.user.id, role: 'client' });
  if (m.error) throw m.error;
  return u.data.user.id;
}

/** Removes what the community flows made: "E2E " posts (and their reports), the demo client's blocks, the buddy. */
async function communityCleanup(): Promise<void> {
  const { workspaceId } = await demoCommunity();
  const posts = await admin.from('community_posts').delete().eq('workspace_id', workspaceId).like('body', 'E2E %');
  if (posts.error) throw posts.error;
  const cards = await admin.from('community_posts').delete().eq('workspace_id', workspaceId).not('card', 'is', null);
  if (cards.error) throw cards.error;
  const blocks = await admin.from('community_blocks').delete().eq('workspace_id', workspaceId);
  if (blocks.error) throw blocks.error;
  const reports = await admin.from('community_reports').delete().eq('workspace_id', workspaceId);
  if (reports.error) throw reports.error;
  const buddy = await findUserId(BUDDY_EMAIL);
  if (buddy) await admin.auth.admin.deleteUser(buddy);
}

/** Deletes every meal (and meal photo) and the targets of the seed demo client. Nobody else's. */
/** Removes every shared meal of Demo Coaching (client meals logged from them keep their numbers; the link clears). */
export async function cleanupCoachMeals(): Promise<void> {
  const { data: ws, error: wsErr } = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (wsErr) throw wsErr;
  const del = await admin.from('coach_meals').delete().eq('workspace_id', ws.id);
  if (del.error) throw del.error;
}

/** The seed coach shares one meal with every client: Protein oats, 450 kcal, 35 g protein, 52 g carbs, 11 g fat. */
export async function seedCoachMeals(): Promise<void> {
  await cleanupCoachMeals();
  const { data: ws, error: wsErr } = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (wsErr) throw wsErr;
  const { error } = await admin.from('coach_meals').insert({
    workspace_id: ws.id,
    name: 'Protein oats',
    calories: 450,
    protein_g: 35,
    carbs_g: 52,
    fat_g: 11,
    ingredients: '60 g rolled oats\n1 scoop whey (30 g)\n200 ml almond milk\nHandful of berries',
    how_to: 'Microwave oats and milk for 2 minutes, stir in the whey, top with berries.',
  });
  if (error) throw error;
}

export async function cleanupFood(email: string): Promise<void> {
  if (email.toLowerCase() !== DEMO_CLIENT) throw new Error(`cleanup-food only clears ${DEMO_CLIENT}`);
  const id = await findUserId(DEMO_CLIENT);
  if (!id) throw new Error(`Seed client ${DEMO_CLIENT} not found (run pnpm db:reset).`);
  const { data: meals, error } = await admin.from('meals').select('photo_path, photo_thumb_path').eq('client_id', id);
  if (error) throw error;
  const paths = meals.flatMap((m) => [m.photo_path, m.photo_thumb_path].filter((p): p is string => p !== null));
  if (paths.length > 0) await admin.storage.from('meal-photos').remove(paths);
  const del = await admin.from('meals').delete().eq('client_id', id);
  if (del.error) throw del.error;
  const targets = await admin.from('nutrition_targets').delete().eq('client_id', id);
  if (targets.error) throw targets.error;
}

/** Starts clean, then the demo coach's daily targets for the demo client: 2,000 kcal, 150 g protein, carbs and fat blank. */
export async function seedFoodTargets(email: string): Promise<void> {
  await cleanupFood(email);
  const clientId = await findUserId(email);
  if (!clientId) throw new Error(`User ${email} not found`);
  const { data: ws, error: wsErr } = await admin.from('workspaces').select('id').eq('name', 'Demo Coaching').single();
  if (wsErr) throw wsErr;
  const { error } = await admin
    .from('nutrition_targets')
    .insert({ workspace_id: ws.id, client_id: clientId, calories: 2000, protein_g: 150 });
  if (error) throw error;
}

async function run(action: string, email: string, name: string): Promise<string | void> {
  if (action === 'confirmlink') return confirmLink(email);
  if (action === 'invitelink') return inviteLink(email, name);
  if (action === 'log-notes') return logNotes(email);
  if (action === 'invite') await invite(email, name);
  else if (action === 'confirm') await confirm(email);
  else if (action === 'cleanup') await cleanup(email);
  else if (action === 'remove') await remove(email);
  else if (action === 'assign') await assign(email);
  else if (action === 'cleanup-workouts') await cleanupWorkouts();
  else if (action === 'assign-today') await assignToday(email);
  else if (action === 'assign-today-mixed') await assignTodayMixed(email);
  else if (action === 'assign-today-sections') await assignTodaySections(email);
  else if (action === 'assign-today-mockup') await assignTodayMockup(email);
  else if (action === 'assign-today-progression') await assignTodayProgression(email);
  else if (action === 'cleanup-logs') await cleanupLogs(email);
  // For these two the "email" is the business name and the "name" is the bio.
  else if (action === 'coach-profile') await setCoachProfile(email, name);
  else if (action === 'coach-profile-reset') await setCoachProfile(DEMO_BUSINESS, '');
  else if (action === 'coach-message') await coachMessage(email, name);
  else if (action === 'assert-reply') await assertReply(email, name);
  else if (action === 'assert-read') await assertRead(email);
  else if (action === 'cleanup-messages') await cleanupMessages(email);
  else if (action === 'seed-scans') await seedScans(email);
  else if (action === 'cleanup-scans') await cleanupScans(email);
  else if (action === 'seed-food-targets') await seedFoodTargets(email);
  else if (action === 'cleanup-food') await cleanupFood(email);
  else if (action === 'seed-coach-meals') await seedCoachMeals();
  else if (action === 'cleanup-coach-meals') await cleanupCoachMeals();
  else if (action === 'community-coach-post') await communityPost((await demoCommunity()).coachId, email);
  else if (action === 'community-buddy-post') await communityPost(await buddyId(), email);
  else if (action === 'community-cleanup') await communityCleanup();
  else if (action === 'coach-take-over') await coachTakeOver(email);
  else if (action === 'coach-log-set') await coachLogSet(email);
  else if (action === 'coach-hand-back') await coachHandBack(email);
  else if (action === 'coach-idle') await coachIdle(email);
  else if (action === 'coach-finish') await coachFinish(email);
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
