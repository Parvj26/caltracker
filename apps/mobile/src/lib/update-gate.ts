import { updateStatus, type UpdateStatus } from '@caltracker/shared';
import { releaseLabel } from './help-legal';

// The required "update the app" screen (the approved update-canvas board). Pure, so it's unit-tested;
// use-update-gate.ts reads the build and the config, and components/update-gate.tsx draws the screen.

export type GateConfig = { minBuild: number; latestBuild: number; updateUrl: string };
export type GateCheck = { status: UpdateStatus; config: GateConfig | null };

/** Reads public.app_config's single row (the Supabase query, kept out so the logic is testable). */
export type UpdateConfigSource = { read: () => PromiseLike<{ data: unknown; error: unknown }> };

/** A slow network must never hold the app: past this the check gives up and lets the user in. */
export const CONFIG_TIMEOUT_MS = 8000;

export const UPDATE_GATE_COPY = {
  eyebrow: 'NEW VERSION READY',
  headline: 'Let’s get you\nup to date',
  body: 'This version is out of date. Update to keep logging your workouts with your coach.',
  button: 'Open TestFlight',
} as const;

export const UPDATE_STEPS = [
  { title: 'Open TestFlight', detail: 'Tap the button below' },
  { title: 'Tap Update', detail: 'Next to CalTracker Coaching' },
  { title: 'Come back here', detail: 'You’ll pick up right where you left off' },
] as const;

/** expo-application's nativeBuildVersion ("3") as a number, or null when it's missing or not a whole number. */
export function parseBuild(build: string | null | undefined): number | null {
  const s = (build ?? '').trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** The config, or null when it can't be read (offline, error, timeout, unexpected shape). Never throws. */
export async function fetchUpdateConfig(source: UpdateConfigSource, timeoutMs = CONFIG_TIMEOUT_MS): Promise<GateConfig | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const read = (async (): Promise<GateConfig | null> => {
    const { data, error } = await source.read();
    if (error || typeof data !== 'object' || data === null) return null;
    const r = data as Record<string, unknown>;
    if (!isCount(r.ios_min_build) || !isCount(r.ios_latest_build) || typeof r.ios_update_url !== 'string') return null;
    return { minBuild: r.ios_min_build, latestBuild: r.ios_latest_build, updateUrl: r.ios_update_url };
  })().catch(() => null);
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether this build must update before it can be used. */
export async function checkForUpdate(source: UpdateConfigSource, nativeBuild: string | null | undefined): Promise<GateCheck> {
  const config = await fetchUpdateConfig(source);
  return { status: updateStatus(parseBuild(nativeBuild), config), config };
}

/** "Version 1.0.0 (3) · Newest (4) · Tip: turn on Automatic Updates in TestFlight". */
export function updateFooter(version: string | null | undefined, build: string | null | undefined, latestBuild: number): string {
  const parts = [`Version ${releaseLabel(version, build)}`];
  if (latestBuild > 0) parts.push(`Newest (${latestBuild})`);
  parts.push('Tip: turn on Automatic Updates in TestFlight');
  return parts.join(' · ');
}
