'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ErrorText, TextField } from '@/components/ui';
import { createBrowserSupabase } from '@/lib/supabase/client';
import styles from '../auth.module.css';

type Enrolment = { factorId: string; qrCode: string; secret: string };

/**
 * `factorId` set: the admin already has two-step, so ask for the code. Null: enrol a new authenticator first (QR code
 * plus the key to type in), then verify the first code. Runs in the browser so the session cookies update in place.
 */
export function MfaForm({ factorId }: { factorId: string | null }) {
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Enrol once per page load (React runs effects twice in development; two enrolments would race).
  const started = useRef(false);

  useEffect(() => {
    if (factorId || started.current) return;
    started.current = true;
    void (async () => {
      const supabase = createBrowserSupabase();
      // A set-up that was started but never finished leaves an unverified factor: clear it and start again.
      const listed = await supabase.auth.mfa.listFactors();
      for (const f of listed.data?.all ?? []) {
        if (f.factor_type === 'totp' && f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (enrolled.error) {
        setError('Could not start two-step set-up. Reload the page to try again.');
        return;
      }
      setEnrolment({ factorId: enrolled.data.id, qrCode: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
    })();
  }, [factorId]);

  const activeFactor = factorId ?? enrolment?.factorId ?? null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activeFactor) return;
    setPending(true);
    setError(null);
    const supabase = createBrowserSupabase();
    const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: activeFactor, code: code.trim() });
    if (verified.error) {
      setPending(false);
      setError("That code didn't work. Check your authenticator app and try again.");
      return;
    }
    router.replace('/overview');
    router.refresh();
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className={styles.form}>
      {factorId ? (
        <p className={styles.lead}>Enter the 6-digit code from your authenticator app.</p>
      ) : (
        <>
          <p className={styles.lead}>Admins sign in with a password and a code from an authenticator app. Scan this with the app, then enter the code it shows.</p>
          {enrolment ? (
            <>
              {/* Supabase returns the QR code as an SVG data URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrolment.qrCode} alt="QR code for your authenticator app" className={styles.qr} />
              <p className={styles.secret}>
                Can&apos;t scan? Type this key:
                <code data-testid="totp-secret">{enrolment.secret}</code>
              </p>
            </>
          ) : null}
        </>
      )}
      <TextField
        label="6-digit code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button type="submit" pending={pending} disabled={!activeFactor} className={styles.submit}>
        {pending ? 'Checking…' : 'Verify'}
      </Button>
    </form>
  );
}
