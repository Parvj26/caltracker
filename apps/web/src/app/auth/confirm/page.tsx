import { redirect } from 'next/navigation';
import styles from '../../(auth)/sign-in/sign-in.module.css';
import { safeNextPath } from '@/lib/safe-next';
import { isOtpType } from '@/lib/otp-type';
import { confirmLink } from './actions';

// Landing point of the links in Supabase auth emails (invite, password reset).
// GET only shows a button: email scanners (Outlook Safe Links and friends) follow links but never click,
// so the one-time token is only spent when the person presses Continue (a POST).
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const { token_hash, type, next } = await searchParams;
  if (!token_hash || !isOtpType(type)) redirect('/sign-in?error=link');
  return (
    <main className={styles.main}>
      <h1>Continue to CalTracker</h1>
      <p>Press Continue to finish signing in.</p>
      <form action={confirmLink} className={styles.form}>
        <input type="hidden" name="token_hash" value={token_hash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={safeNextPath(next)} />
        <button type="submit">Continue</button>
      </form>
    </main>
  );
}
