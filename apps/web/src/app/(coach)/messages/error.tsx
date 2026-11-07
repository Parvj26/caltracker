'use client';

import { Button } from '@/components/ui';
import styles from './messages.module.css';

/** Shown when the inbox or a conversation can't load (the server threw). "Try again" asks Next to render it again. */
export default function MessagesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className={styles.errorPanel} role="alert">
      <h1 className={styles.heading}>Couldn&apos;t load messages</h1>
      <p className={styles.errorText}>Something went wrong on our side. Check your connection and try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
