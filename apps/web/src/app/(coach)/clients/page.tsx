import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { AddClientForm } from './add-client-form';
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
      <h1>Clients</h1>

      <section>
        <h2>Clients</h2>
        <table aria-label="Clients" className={styles.table}>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Joined</th></tr>
          </thead>
          <tbody>
            {members.data.length === 0 ? (
              <tr><td colSpan={3}>No clients yet. Add one below.</td></tr>
            ) : (
              members.data.map((m) => (
                <tr key={m.user_id}>
                  <td>{nameByUser.get(m.user_id) ?? ''}</td>
                  <td>{emailByUser.get(m.user_id) ?? ''}</td>
                  <td>{m.created_at ? dateFormat.format(new Date(m.created_at)) : ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Pending invites</h2>
        <table aria-label="Pending invites" className={styles.table}>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Sent</th><th>Expires</th><th></th></tr>
          </thead>
          <tbody>
            {pending.length === 0 ? (
              <tr><td colSpan={5}>No pending invites.</td></tr>
            ) : (
              pending.map((i) => (
                <tr key={i.id}>
                  <td>{i.full_name}</td>
                  <td>{i.email}</td>
                  <td>{dateFormat.format(new Date(i.sent_at))}</td>
                  <td>{expiryLabel(i.expires_at)}</td>
                  <td><ResendButton email={i.email} fullName={i.full_name} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <AddClientForm />
      <CsvUpload />
    </div>
  );
}
