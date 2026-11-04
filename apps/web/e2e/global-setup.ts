import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// Seeds the 20-exercise fixture (idempotent) and exposes service-role env to tests for cleanup.
export default function globalSetup() {
  const root = join(__dirname, '..', '..', '..');
  const out = execFileSync('supabase', ['status', '-o', 'env'], { cwd: root, encoding: 'utf8' });
  const env: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = /^(API_URL|SERVICE_ROLE_KEY)="?([^"]*)"?$/.exec(line.trim());
    if (m) env[m[1]!] = m[2]!;
  }
  process.env.SUPABASE_URL = env.API_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY;
  execFileSync('pnpm', ['import:exercises', '--fixture', 'scripts/fixtures/free-exercise-db'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
}
