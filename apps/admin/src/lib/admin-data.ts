/** Shapes of the jsonb the admin_* functions return (see supabase/migrations/20261109010100_admin_reads.sql). */

export type Overview = {
  coaches: { total: number; active7: number; new7: number };
  clients: { total: number; active7: number; new7: number };
  workouts: { this_week: number; last_week: number };
  meals: { this_week: number; last_week: number };
  system: {
    last_push_run_at: string | null;
    last_push_status: string | null;
    push_failed_24h: number;
    invites_sent_today: number;
    app_versions: Array<{ version: string; devices: number }>;
  };
};

export type CoachSummary = {
  user_id: string;
  name: string;
  clients: Array<{ user_id: string; name: string }>;
  programs: Array<{ id: string; name: string; weeks: number }>;
  meals_shared: number;
  median_reply_minutes_30d: number | null;
};

export type ClientDetail = {
  user_id: string;
  name: string;
  email: string | null;
  workspace_id: string | null;
  coach: { user_id: string; name: string } | null;
  joined_at: string | null;
  email_confirmed: boolean;
  last_sign_in_at: string | null;
  devices: Array<{ app_version: string | null; last_seen_at: string }>;
  notifications_on: boolean;
  last_sync_at: string | null;
  push_errors: Array<{ at: string; type: string; error: string }>;
  removed: {
    workspace_id: string;
    workspace_name: string;
    removed_at: string;
    email: string;
    first_name: string;
    last_name: string;
  } | null;
};

export type ViewAsSnapshot = {
  profile: { name: string; units: string } | null;
  coach: { name: string } | null;
  today: { date: string; workouts: Array<{ id: string; name: string; status: 'planned' | 'in_progress' | 'done' }> };
  week: { done: number; planned: number };
  recent_logs: Array<{ id: string; title: string; finished_at: string; duration_s: number | null; volume: number | null }>;
  meals_today: Array<{ name: string; kcal: number | null; protein_g: number | null }>;
  targets: { kcal: number | null; protein_g: number | null } | null;
  goal: { text: string; target_date: string | null } | null;
  coach_meals: number;
  bests: Array<{ exercise: string; weight: number | null; reps: number | null; at: string }>;
};

/**
 * The database builds these objects (jsonb_build_object), so their shape is fixed by the migration; this is the one
 * place the untyped Json is read as that shape.
 */
export function fromJson<T>(value: unknown): T {
  return value as T;
}

/** "Luis Bueno", or a stand-in when the profile has no name yet. */
export function nameOr(name: string | null | undefined, fallback = 'No name yet'): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : fallback;
}

/** "~3 h", "~25 min", or "—". */
export function replyTimeLabel(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  return `~${Math.round(minutes / 60)} h`;
}

/** Plain words for an audit action. */
export function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    set_admin: 'Added or changed an admin',
    remove_admin: 'Removed an admin',
    cancel_invite: 'Cancelled an invite',
    remove_client: 'Removed a client from their coach',
    password_reset: 'Sent a password reset',
    send_test_push: 'Sent a test notification',
    log_timeline_view: 'Opened a timeline',
    view_as_snapshot: 'Opened View as',
    resend_invite: 'Resent an invite',
    add_coach: 'Added a coach',
    delete_coach: 'Deleted a coach',
  };
  return labels[action] ?? action;
}
