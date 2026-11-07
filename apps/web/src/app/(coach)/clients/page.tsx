import type { Metadata } from 'next';
import Link from 'next/link';
import { COMPLETION_WINDOW_DAYS, formatFullName, localToday } from '@caltracker/shared';
import { Card } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { requireCoach } from '@/lib/auth';
import { loadHomeData } from '@/lib/coach-home';
import { loadPickerHistory, pickerHints } from '@/lib/picker-hints';
import { createServerSupabase } from '@/lib/supabase/server';
import { avatarTone, initials } from './avatar';
import { ClientDirectory, type DirectoryInvite, type InvitePlanSummary } from './client-directory';
import { InviteClientButton } from './invite-dialog';
import { newestInviteFirst } from './pending-order';
import { PastClients } from './past-clients';
import { ResendButton } from './resend-button';
import styles from './clients.module.css';

export const metadata: Metadata = { title: 'Clients' };

/** The Clients list looks this far back for each client's last workout (Home only needs 30 days). */
const LAST_WORKOUT_LOOKBACK_DAYS = 90;
/** How far ahead the list looks for a client's next single workout (the Plan column). */
const NEXT_WORKOUT_AHEAD_DAYS = 60;
/** Same cap as the workout library page. */
const LIBRARY_LIMIT = 200;

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

function Avatar({ name, toneKey }: { name: string; toneKey: string }) {
  return (
    <span aria-hidden="true" data-avatar="" className={cx(styles.avatar, styles[`avatar-${avatarTone(toneKey)}`])}>
      {initials(name)}
    </span>
  );
}

const isExpired = (expiresAt: string) => Date.parse(expiresAt) <= Date.now();

type PlanItemRow = { start_on: string; position: number; programs: { name: string } | null; workouts: { name: string } | null };

/** What an invite will start with, from the plan kept with it (see set_invite_plan). */
function planSummary(items: PlanItemRow[]): InvitePlanSummary {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const first = sorted[0];
  if (!first) return null;
  if (first.programs) return { kind: 'program', name: first.programs.name, on: first.start_on };
  const workouts = sorted.filter((i) => i.workouts);
  const firstWorkout = workouts[0];
  if (!firstWorkout?.workouts) return null;
  return { kind: 'single', name: firstWorkout.workouts.name, on: firstWorkout.start_on, more: workouts.length - 1 };
}

export default async function ClientsPage() {
  const { workspaceId, userId, firstName, lastName } = await requireCoach();
  const supabase = await createServerSupabase();
  const utcToday = localToday('UTC');

  // A fixed number of workspace-scoped reads (never one per client), all in parallel.
  const [data, invites, past, library, programs, pickerHistory] = await Promise.all([
    // Current clients with 4 weeks back and 2 months ahead of planned workouts, their programs and last workouts.
    loadHomeData(supabase, workspaceId, utcToday, LAST_WORKOUT_LOOKBACK_DAYS, {
      backDays: COMPLETION_WINDOW_DAYS,
      aheadDays: NEXT_WORKOUT_AHEAD_DAYS,
    }),
    supabase
      .from('client_invites')
      .select('id, email, first_name, last_name, full_name, sent_at, expires_at, accepted_at, accepted_by, created_at, client_invite_plan_items(start_on, position, programs(name), workouts(name))')
      .eq('workspace_id', workspaceId)
      .order('sent_at', { ascending: false }),
    supabase
      .from('past_clients')
      .select('user_id, email, first_name, last_name, full_name, removed_at')
      .eq('workspace_id', workspaceId)
      .order('removed_at', { ascending: false }),
    // For "Give them something to start with" in the invite window.
    supabase.from('workouts').select('id, name').eq('workspace_id', workspaceId).is('client_id', null).order('name').limit(LIBRARY_LIMIT),
    supabase.from('programs').select('id, name, weeks').eq('workspace_id', workspaceId).order('name'),
    loadPickerHistory(supabase, workspaceId, userId),
  ]);
  if (past.error) throw new Error(`Could not load past clients: ${past.error.message}`);
  if (invites.error) throw new Error(`Could not load invites: ${invites.error.message}`);
  if (library.error) throw new Error(`Could not load workouts: ${library.error.message}`);
  if (programs.error) throw new Error(`Could not load programs: ${programs.error.message}`);

  const pending: DirectoryInvite[] = invites.data
    .filter((i) => i.accepted_at === null)
    .sort(newestInviteFirst)
    .map((i) => ({
      id: i.id,
      name: i.full_name,
      email: i.email,
      firstName: i.first_name,
      lastName: i.last_name,
      sentAt: i.sent_at,
      expired: isExpired(i.expires_at),
      plan: planSummary(i.client_invite_plan_items),
    }));

  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>
          Clients <span className={styles.titleCount}>{data.clients.length + pending.length}</span>
        </h1>
        <InviteClientButton
          coachName={formatFullName({ firstName, lastName }) || 'Your coach'}
          library={library.data}
          programs={programs.data}
          hints={pickerHints(pickerHistory, library.data)}
        />
      </header>

      <ClientDirectory data={data} invites={pending} lookbackDays={LAST_WORKOUT_LOOKBACK_DAYS} />

      {past.data.length > 0 ? (
        <Card className={styles.listCard}>
          <PastClients count={past.data.length}>
            <div role="table" aria-label="Past clients" className={cx(styles.rows, styles.pastRows)}>
              <div role="rowgroup" className={styles.headRow}>
                <div role="row" className={styles.row}>
                  <span role="columnheader">Name</span>
                  <span role="columnheader">Email</span>
                  <span role="columnheader">Removed</span>
                  <span role="columnheader"><span className={styles.visuallyHidden}>Actions</span></span>
                </div>
              </div>
              <div role="rowgroup">
                {past.data.map((p) => (
                  <div role="row" key={p.user_id} className={styles.row}>
                    <div role="cell" className={styles.nameCell}>
                      <Avatar name={p.full_name || p.email} toneKey={p.user_id} />
                      <Link href={`/clients/${p.user_id}`} className={cx(styles.name, styles.nameLink)}>{p.full_name || p.email || 'Client'}</Link>
                    </div>
                    <span role="cell" className={styles.email}>{p.email}</span>
                    <span role="cell" className={styles.meta}>
                      {`Removed ${dateFormat.format(new Date(p.removed_at))}`}
                    </span>
                    <div role="cell" className={styles.actions}>
                      <ResendButton
                        email={p.email}
                        firstName={p.first_name || p.email.split('@')[0] || 'Client'}
                        lastName={p.last_name}
                        label="Re-invite"
                        ariaLabel={`Re-invite ${p.full_name || p.email}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </PastClients>
        </Card>
      ) : null}
    </div>
  );
}
