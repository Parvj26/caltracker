'use client';

import { useId, useRef } from 'react';
import { Button } from '@/components/ui';
import styles from './profile.module.css';

/**
 * Sign out, at the foot of Profile. It asks first, in a native modal dialog (a bottom sheet on an iPhone): signing out
 * by accident means typing the email and password again. Signing out posts to the existing /auth/sign-out route, which
 * ends this browser's session only.
 */
export function SignOut() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  return (
    <>
      <Button variant="secondary" className={styles.signOutButton} onClick={() => dialogRef.current?.showModal()} data-ph-capture-attribute-label="sign_out_open" phSafe>
        Sign out
      </Button>
      <dialog ref={dialogRef} className={styles.signOutDialog} aria-labelledby={titleId} aria-describedby={bodyId}>
        <span className={styles.grab} aria-hidden="true" />
        <h2 id={titleId} className={styles.signOutTitle} data-ph-safe="">Sign out?</h2>
        <p id={bodyId} className={styles.signOutBody} data-ph-safe="">
          You&apos;ll need your email and password to sign back in on this device.
        </p>
        <form action="/auth/sign-out" method="post" className={styles.signOutActions}>
          <Button type="submit" data-ph-capture-attribute-label="sign_out" phSafe>
            Sign out
          </Button>
          <Button variant="secondary" onClick={() => dialogRef.current?.close()} phSafe>
            Stay signed in
          </Button>
        </form>
      </dialog>
    </>
  );
}
