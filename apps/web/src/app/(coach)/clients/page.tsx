import { compareByLastName } from '@caltracker/shared';
import { Card, Chip } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { AddClientForm } from './add-client-form';
import { avatarTone, initials } from './avatar';
import { CsvUpload } from './csv-upload';
import { newestInviteFirst } from './pending-order';
import { PastClients } from './past-clients';
import { ResendButton } from './resend-button';
import { CancelInviteButton, RemoveClientButton } from './row-actions';
import styles from './clients.module.css';

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

function NameCell({ name, toneKey }: { name: string; toneKey: string }) {
  return (
    <div role="cell" className={styles.nameCell}>
      <Avatar name={name} toneKey={toneKey} />
      <span className={styles.name}>{name}</span>
    </div>
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function ClientsPage() {
  const { workspaceId } = await requireCoach();
  const supabase = await createServerSupabase();

  const [members, invites, past] = await Promise.all([
    supabase
      .from('workspace_members')
      .select('user_id, created_at')
      .eq('workspace_id', workspaceId)
      .eq('role', 'client')
      .order('created_at', { ascending: true }),
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
  if (members.error) throw new Error(`Could not load clients: ${members.error.message}`);
  if (invites.error) throw new Error(`Could not load invites: ${invites.error.message}`);

  // No direct foreign key links workspace_members to profiles, so load names separately.
  const profiles = members.data.length
    ? await supabase.from('profiles').select('id, first_name, last_name, full_name').in('id', members.data.map((m) => m.user_id))
    : { data: [], error: null };
  if (profiles.error) throw new Error(`Could not load client names: ${profiles.error.message}`);
  const profileByUser = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const nameOf = (userId: string) => {
    const p = profileByUser.get(userId);
    return { firstName: p?.first_name ?? '', lastName: p?.last_name ?? '' };
  };
  // Joined clients are sorted by last name, then first name; pending invites newest first (below).
  const clients = [...members.data].sort((a, b) => compareByLastName(nameOf(a.user_id), nameOf(b.user_id)));

  // Client emails live in auth.users, which RLS hides; fall back to the accepted invite's email.
  const emailByUser = new Map(
    invites.data.filter((i) => i.accepted_by).map((i) => [i.accepted_by as string, i.email]),
  );
  const pending = invites.data.filter((i) => i.accepted_at === null).sort(newestInviteFirst);

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

      <Card className={styles.listCard}>
        <section aria-labelledby="clients-heading">
          <h2 id="clients-heading" tabIndex={-1} className={styles.sectionHeading}>Clients</h2>
          <div role="table" aria-label="Clients" className={cx(styles.rows, styles.clientRows)}>
            <div role="rowgroup" className={styles.headRow}>
              <div role="row" className={styles.row}>
                <span role="columnheader">Name</span>
                <span role="columnheader">Email</span>
                <span role="columnheader">Joined</span>
                <span role="columnheader"><span className={styles.visuallyHidden}>Actions</span></span>
              </div>
            </div>
            <div role="rowgroup">
              {clients.length === 0 ? (
                <div role="row" className={styles.emptyRow}>
                  <span role="cell">No clients yet. Add one above.</span>
                </div>
              ) : (
                clients.map((m) => {
                  const joined = m.created_at ? dateFormat.format(new Date(m.created_at)) : '';
                  const name = profileByUser.get(m.user_id)?.full_name ?? '';
                  return (
                    <div role="row" key={m.user_id} className={styles.row}>
                      <NameCell name={name} toneKey={m.user_id} />
                      <span role="cell" className={styles.email}>{emailByUser.get(m.user_id) ?? ''}</span>
                      <span role="cell" className={styles.meta}>
                        {joined ? <span aria-hidden="true" className={styles.narrowOnly}>Joined </span> : null}
                        {joined}
                      </span>
                      <div role="cell" className={styles.actions}>
                        <RemoveClientButton userId={m.user_id} name={name} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </Card>

      <Card className={styles.listCard}>
        <section aria-labelledby="pending-heading">
          <h2 id="pending-heading" tabIndex={-1} className={styles.sectionHeading}>Pending invites</h2>
          <div role="table" aria-label="Pending invites" className={cx(styles.rows, styles.inviteRows)}>
            <div role="rowgroup" className={styles.headRow}>
              <div role="row" className={styles.row}>
                <span role="columnheader">Name</span>
                <span role="columnheader">Email</span>
                <span role="columnheader">Sent</span>
                <span role="columnheader">Expires</span>
                <span role="columnheader"><span className={styles.visuallyHidden}>Actions</span></span>
              </div>
            </div>
            <div role="rowgroup">
              {pending.length === 0 ? (
                <div role="row" className={styles.emptyRow}>
                  <span role="cell">No pending invites.</span>
                </div>
              ) : (
                pending.map((i) => {
                  const expiry = expiryLabel(i.expires_at);
                  return (
                    <div role="row" key={i.id} className={styles.row}>
                      <NameCell name={i.full_name} toneKey={i.email} />
                      <span role="cell" className={styles.email}>{i.email}</span>
                      <span role="cell" className={styles.meta}>
                        <span aria-hidden="true" className={styles.narrowOnly}>Sent </span>
                        {dateFormat.format(new Date(i.sent_at))}
                      </span>
                      <span role="cell" className={styles.expires}>
                        <Chip tone={expiry === 'Expired' ? 'amber' : 'grey'}>{expiry}</Chip>
                      </span>
                      <div role="cell" className={styles.actions}>
                        <ResendButton email={i.email} firstName={i.first_name} lastName={i.last_name} />
                        <CancelInviteButton inviteId={i.id} email={i.email} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </Card>

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
                    <NameCell name={p.full_name ?? ''} toneKey={p.user_id} />
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
