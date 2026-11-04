import { execSync } from 'node:child_process';

// Fills SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the local stack when they
// are not already set, so a plain `pnpm test` works without manual exports.
export default function setup(): void {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  let out: string;
  try {
    out = execSync('supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error(
      "Local Supabase isn't running — run `supabase start` (or pnpm db:start) first.",
    );
  }
  const env: Record<string, string> = {};
  for (const line of out.split('\n')) {
    const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (m?.[1] && m[2] !== undefined) env[m[1]] = m[2];
  }
  process.env.SUPABASE_URL ??= env.API_URL ?? '';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= env.SERVICE_ROLE_KEY ?? '';
  process.env.PUBLIC_SITE_URL ??= 'http://localhost:3000';
}
