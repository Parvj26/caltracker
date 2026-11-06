import Link from 'next/link';
import { formatFullName, localToday } from '@caltracker/shared';
import { Card } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { requireCoach } from '@/lib/auth';
import { loadHomeData } from '@/lib/coach-home';
import { createServerSupabase } from '@/lib/supabase/server';
import { AddClientForm } from './add-client-form';
import { avatarTone, initials } from './avatar';
import { ClientDirectory } from './client-directory';
import { CsvUpload } from './csv-upload';
import { newestInviteFirst } from './pending-order';
import { PastClients } from './past-clients';
import { ResendButton } from './resend-button';
import styles from './clients.module.css';

/** The Clients list looks this far back for each client's last workout (Home only needs 30 days). */
const LAST_WORKOUT_LOOKBACK_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

function expiryLabel(expiresAt: string): string {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / DAY_MS);
  if (days <= 0) return 'Expired';
  return `Expires in ${days} day${days === 1 ? '' : 's'}`;
}

function Avatar({ name, toneKey }: { name: string; toneKey: string }) {
  return (
    <span aria-hidden="true" data-avatar="" className={cx(styles.avatar, styles[`avatar-${avatarTone(toneKey)}`])}>
      {initials(name)}
    </span>
  );
}

/** With `href`, the name links to that page (a joined client's calendar). */
function NameCell({ name, toneKey, href }: { name: string; toneKey: string; href?: string }) {
  return (
    <div role="cell" className={styles.nameCell}>
      <Avatar name={name} toneKey={toneKey} />
      {href ? (
        <Link href={href} className={cx(styles.name, styles.nameLink)}>{name || 'Client'}</Link>
      ) : (
        <span className={styles.name}>{name}</span>
      )}
    </div>
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function ClientsPage() {
  const { workspaceId } = await requireCoach();
  const supabase = await createServerSupabase();

  const [data, invites, past] = await Promise.all([
    // Current clients with their recent workouts, programs and PRs: the same rows Home's daily check reads.
    loadHomeData(supabase, workspaceId, localToday('UTC'), LAST_WORKOUT_LOOKBACK_DAYS),
    supabase
      .from('client_invites')
      .select('id, email, first_name, last_name, full_name, sent_at, expires_at, accepted_at, accepted_by, created_at')
      .eq('workspace_id', workspaceId)
      .order('sent_at', { ascending: false }),
    supabase
      .from('past_clients')
      .select('user_id, email, first_name, last_name, full_name, removed_at')
      .eq('workspace_id', workspaceId)
      .order('removed_at', { ascending: false }),
  ]);
  if (past.error) throw new Error(`Could not load past clients: ${past.error.message}`);
  if (invites.error) throw new Error(`Could not load invites: ${invites.error.message}`);

  // Client emails live in auth.users, which RLS hides; fall back to the accepted invite's email.
  const emailByUser = new Map(
    invites.data.filter((i) => i.accepted_by).map((i) => [i.accepted_by as string, i.email]),
  );
  const clients = data.clients.map((c) => ({ id: c.id, name: formatFullName(c), email: emailByUser.get(c.id) ?? '' }));
  const pending = invites.data
    .filter((i) => i.accepted_at === null)
    .sort(newestInviteFirst)
    .map((i) => ({
      id: i.id,
      name: i.full_name,
      email: i.email,
      firstName: i.first_name,
      lastName: i.last_name,
      sent: dateFormat.format(new Date(i.sent_at)),
      expiry: expiryLabel(i.expires_at),
    }));

  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>Clients</h1>
        <p className={styles.caption}>
          {count(clients.length, 'client', 'clients')} · {count(pending.length, 'pending invite', 'pending invites')}
        </p>
      </header>

      <Card className={styles.addCard}>
        <AddClientForm />
        <CsvUpload />
      </Card>

      <ClientDirectory data={data} people={clients} invites={pending} lookbackDays={LAST_WORKOUT_LOOKBACK_DAYS} />

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
                    <NameCell name={p.full_name || p.email} toneKey={p.user_id} href={`/clients/${p.user_id}`} />
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
