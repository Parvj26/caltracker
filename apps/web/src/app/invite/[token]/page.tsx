import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { createServerSupabase } from '@/lib/supabase/server';
import { inviteUrlFrom, isMobileUserAgent, qrSvg, storeLinks } from '@/lib/invite-page';
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

/**
 * Shown on computers: the same invite link as a QR code, so the client can switch to their phone.
 * A computer user agent always sees it; any screen at least 900 px wide sees it through CSS. Phones never do.
 */
async function InviteQr({ url, computer }: { url: string; computer: boolean }) {
  let svg: string;
  try {
    svg = await qrSvg(url);
  } catch {
    return null;
  }
  return (
    <figure className={`${styles.qr} ${computer ? styles.qrComputer : ''}`} data-invite-qr="">
      {/* Safe: the SVG is generated on our server from the invite URL and holds only shapes. */}
      <div className={styles.qrImage} role="img" aria-label="QR code for this invite" dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption className={styles.qrCaption}>Scan with your phone to join</figcaption>
    </figure>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = await loadPreview(token);

  const valid = preview.status === 'valid' && preview.workspace_name && preview.email;
  if (valid) {
    const h = await headers();
    const inviteUrl = inviteUrlFrom(
      h.get('x-forwarded-host') ?? h.get('host'),
      h.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? null,
      token,
    );
    const computer = !isMobileUserAgent(h.get('user-agent'));
    const stores = storeLinks(process.env.NEXT_PUBLIC_APP_STORE_URL || undefined, process.env.NEXT_PUBLIC_PLAY_STORE_URL || undefined);
    return (
      <AuthShell title={`${preview.workspace_name} invited you to CalTracker`} note="Let's get moving!">
        {inviteUrl ? <InviteQr url={inviteUrl} computer={computer} /> : null}
        <p className={styles.lead}>Already have the app? Open it and join. You only need to choose a password.</p>
        <div className={styles.buttons}>
          {/* The token is safe to put here: it is already in the URL of this page. */}
          <a className={styles.button} href={`caltracker://invite/${token}`}>
            Open in CalTracker
          </a>
        </div>
        <p className={styles.lead}>
          Don&apos;t have it yet? Install CalTracker, then tap the link in your email again.
        </p>
        <p className={styles.lead}>
          You&apos;ll sign in with <strong>{preview.email}</strong>.
        </p>
        {stores.length > 0 ? (
          <div className={styles.buttons}>
            {stores.map((store) => (
              <a key={store.label} className={styles.button} href={store.href}>
                {store.label}
              </a>
            ))}
          </div>
        ) : (
          <div className={styles.note}>
            <p className={styles.noteTitle}>Your coach will help you get the app</p>
            <p className={styles.lead}>CalTracker isn&apos;t in the app stores yet. Ask your coach and they&apos;ll show you how to install it.</p>
          </div>
        )}
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
