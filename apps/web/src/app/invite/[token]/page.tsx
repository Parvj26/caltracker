import type { Metadata } from 'next';
import { createServerSupabase } from '@/lib/supabase/server';
import { AuthShell } from '@/components/ui';
import styles from './invite.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'CalTracker invite',
  robots: { index: false, follow: false },
};

type Preview = { status: string; workspace_name: string | null; email: string | null };

// Raw tokens are base64url; anything else cannot match, so skip the database call.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,100}$/;
const NOT_FOUND: Preview = { status: 'not_found', workspace_name: null, email: null };

async function loadPreview(token: string): Promise<Preview> {
  if (!TOKEN_SHAPE.test(token)) return NOT_FOUND;
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc('get_invite_preview', { token });
    if (error) return NOT_FOUND;
    const row = Array.isArray(data) ? data[0] : data;
    return row ?? NOT_FOUND;
  } catch {
    return NOT_FOUND;
  }
}

function StoreButton({ label, href }: { label: string; href: string | undefined }) {
  if (!href) {
    return (
      <span className={`${styles.button} ${styles.disabled}`} aria-disabled="true">
        {label}
        <small>Coming soon</small>
      </span>
    );
  }
  return (
    <a className={styles.button} href={href}>
      {label}
    </a>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await loadPreview(token);

  const valid = preview.status === 'valid' && preview.workspace_name && preview.email;
  if (valid) {
    return (
      <AuthShell title={`${preview.workspace_name} invited you to CalTracker`} note="Let's get moving!">
        <p className={styles.lead}>
          Download the CalTracker app and sign up with <strong>{preview.email}</strong>.
        </p>
        <div className={styles.buttons}>
          <StoreButton label="App Store" href={process.env.NEXT_PUBLIC_APP_STORE_URL || undefined} />
          <StoreButton label="Google Play" href={process.env.NEXT_PUBLIC_PLAY_STORE_URL || undefined} />
        </div>
      </AuthShell>
    );
  }
  const [title, message] =
    preview.status === 'expired'
      ? ['Invite expired', 'This invite has expired. Ask your coach to send a new one.']
      : preview.status === 'accepted'
        ? ['Invite already used', 'This invite has already been used. Open the CalTracker app and sign in.']
        : ['Invite not valid', "This invite link isn't valid. Check the link in your email or ask your coach to send a new one."];
  return (
    <AuthShell title={title}>
      <p className={styles.lead}>{message}</p>
    </AuthShell>
  );
}
