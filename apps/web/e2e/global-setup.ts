import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';

// Seeds the 20-exercise fixture (idempotent), resets the demo coach to kg, and exposes service-role env to tests.
export default async function globalSetup() {
  const root = join(__dirname, '..', '..', '..');
  // The local auth container runs out of ports under a full run; tune it (not needed on GitHub-hosted runners, but needed
  // on a Mac, including the self-hosted CI runner). It targets this checkout's stack. A missing docker is a warning only.
  if (process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    try {
      execFileSync('bash', [join(root, 'scripts', 'tune-local-auth.sh')], { stdio: 'inherit' });
    } catch (e) {
      console.warn(`Could not tune the local auth container (is docker running?): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const out = execFileSync('supabase', ['status', '-o', 'env'], { cwd: root, encoding: 'utf8' });
  const env: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = /^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)="?([^"]*)"?$/.exec(line.trim());
    if (m) env[m[1]!] = m[2]!;
  }
  process.env.SUPABASE_URL = env.API_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY;
  // For specs that act as a real user (a phone or a coach outside the browser), as the apps do.
  process.env.SUPABASE_ANON_KEY = env.ANON_KEY;
  execFileSync('pnpm', ['import:exercises', '--fixture', 'scripts/fixtures/free-exercise-db'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  // Every run starts with the shared demo coach in kg (the pounds test uses its own coach, but a manual change could stick).
  const admin = createClient<Database>(env.API_URL!, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const coach = data.users.find((u) => u.email === 'coach@demo.local');
  if (!coach) throw new Error('Demo coach coach@demo.local not found; run pnpm db:reset.');
  const reset = await admin.from('profiles').update({ units: 'kg' }).eq('id', coach.id);
  if (reset.error) throw reset.error;
}
