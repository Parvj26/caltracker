'use client';

import { Button, ErrorText } from '@/components/ui';
import styles from './messages.module.css';

/** Shown when the inbox or a conversation can't load (the server threw). "Try again" asks Next to render it again. */
export default function MessagesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className={styles.errorPanel}>
      <h1 className={styles.heading} data-ph-safe="">Couldn&apos;t load messages</h1>
      <ErrorText code="messages_load_failed" className={styles.errorText} />
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
