import { Card, Chip } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { AddClientForm } from './add-client-form';
import { avatarTone, initials } from './avatar';
import { CsvUpload } from './csv-upload';
import { ResendButton } from './resend-button';
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

  const [members, invites] = await Promise.all([
    supabase
      .from('workspace_members')
      .select('user_id, created_at')
      .eq('workspace_id', workspaceId)
      .eq('role', 'client')
      .order('created_at', { ascending: true }),
    supabase
      .from('client_invites')
      .select('id, email, full_name, sent_at, expires_at, accepted_at, accepted_by')
      .eq('workspace_id', workspaceId)
      .order('sent_at', { ascending: false }),
  ]);
  if (members.error) throw new Error(`Could not load clients: ${members.error.message}`);
  if (invites.error) throw new Error(`Could not load invites: ${invites.error.message}`);

  // No direct foreign key links workspace_members to profiles, so load names separately.
  const profiles = members.data.length
    ? await supabase.from('profiles').select('id, full_name').in('id', members.data.map((m) => m.user_id))
    : { data: [], error: null };
  if (profiles.error) throw new Error(`Could not load client names: ${profiles.error.message}`);
  const nameByUser = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name]));

  // Client emails live in auth.users, which RLS hides; fall back to the accepted invite's email.
  const emailByUser = new Map(
    invites.data.filter((i) => i.accepted_by).map((i) => [i.accepted_by as string, i.email]),
  );
  const pending = invites.data.filter((i) => i.accepted_at === null);

  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>Clients</h1>
        <p className={styles.caption}>
          {count(members.data.length, 'client', 'clients')} · {count(pending.length, 'pending invite', 'pending invites')}
        </p>
      </header>

      <Card className={styles.addCard}>
        <AddClientForm />
        <CsvUpload />
      </Card>

      <Card className={styles.listCard}>
        <section aria-labelledby="clients-heading">
          <h2 id="clients-heading" className={styles.sectionHeading}>Clients</h2>
          <div role="table" aria-label="Clients" className={cx(styles.rows, styles.clientRows)}>
            <div role="rowgroup" className={styles.headRow}>
              <div role="row" className={styles.row}>
                <span role="columnheader">Name</span>
                <span role="columnheader">Email</span>
                <span role="columnheader">Joined</span>
              </div>
            </div>
            <div role="rowgroup">
              {members.data.length === 0 ? (
                <div role="row" className={styles.emptyRow}>
                  <span role="cell">No clients yet. Add one above.</span>
                </div>
              ) : (
                members.data.map((m) => {
                  const joined = m.created_at ? dateFormat.format(new Date(m.created_at)) : '';
                  return (
                    <div role="row" key={m.user_id} className={styles.row}>
                      <NameCell name={nameByUser.get(m.user_id) ?? ''} toneKey={m.user_id} />
                      <span role="cell" className={styles.email}>{emailByUser.get(m.user_id) ?? ''}</span>
                      <span role="cell" className={styles.meta}>
                        {joined ? <span aria-hidden="true" className={styles.narrowOnly}>Joined </span> : null}
                        {joined}
                      </span>
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
          <h2 id="pending-heading" className={styles.sectionHeading}>Pending invites</h2>
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
                      <span role="cell" className={styles.actions}>
                        <ResendButton email={i.email} fullName={i.full_name} />
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </Card>

    </div>
  );
}
