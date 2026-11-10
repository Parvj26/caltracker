import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// Exposes the local stack's keys to the specs (fixtures only; the admin site itself never sees the service role).
export default function globalSetup() {
  const root = join(__dirname, '..', '..', '..');
  const out = execFileSync('supabase', ['status', '-o', 'env'], { cwd: root, encoding: 'utf8' });
  for (const line of out.split('\n')) {
    const m = /^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)="?([^"]*)"?$/.exec(line.trim());
    if (!m) continue;
    const name = { API_URL: 'SUPABASE_URL', ANON_KEY: 'SUPABASE_ANON_KEY', SERVICE_ROLE_KEY: 'SUPABASE_SERVICE_ROLE_KEY' }[m[1]!]!;
    process.env[name] = m[2]!;
  }
}
