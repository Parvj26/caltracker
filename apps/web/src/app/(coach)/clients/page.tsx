import type { Metadata } from 'next';
import { COMPLETION_WINDOW_DAYS, formatFullName, localToday } from '@caltracker/shared';
import { ListRow, PageHeader, RowList } from '@/components/ui';
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

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workspaceId, userId, firstName, lastName } = await requireCoach();
  // The search box keeps its text in ?q=, so Back to Clients brings the same results.
  const rawQ = (await searchParams).q;
  const initialQuery = ((Array.isArray(rawQ) ? rawQ[0] : rawQ) ?? '').slice(0, 100);
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

  const invitedCount = pending.length;
  return (
    <div className={styles.page}>
      {/* The count is clients; invites waiting are counted on their own (the Invited chip and this line). */}
      <PageHeader
        title="Clients"
        count={data.clients.length}
        subtitle={invitedCount > 0 ? `${invitedCount} ${invitedCount === 1 ? 'invite' : 'invites'} waiting` : undefined}
        action={
          <InviteClientButton
            coachName={formatFullName({ firstName, lastName }) || 'Your coach'}
            library={library.data}
            programs={programs.data}
            hints={pickerHints(pickerHistory, library.data)}
          />
        }
      />

      <ClientDirectory data={data} invites={pending} lookbackDays={LAST_WORKOUT_LOOKBACK_DAYS} initialQuery={initialQuery} />

      {past.data.length > 0 ? (
        <PastClients count={past.data.length}>
          <RowList aria-label="Past clients" className={styles.clientList}>
            {past.data.map((p) => (
              <ListRow
                key={p.user_id}
                href={`/clients/${p.user_id}`}
                title={p.full_name || p.email || 'Client'}
                leading={<Avatar name={p.full_name || p.email} toneKey={p.user_id} />}
                meta={
                  <>
                    <span className={styles.inviteEmail}>{p.email}</span>
                    <span>{`Removed ${dateFormat.format(new Date(p.removed_at))}`}</span>
                  </>
                }
                action={
                  <ResendButton
                    email={p.email}
                    firstName={p.first_name || p.email.split('@')[0] || 'Client'}
                    lastName={p.last_name}
                    label="Re-invite"
                    ariaLabel={`Re-invite ${p.full_name || p.email}`}
                  />
                }
              />
            ))}
          </RowList>
        </PastClients>
      ) : null}
    </div>
  );
}
