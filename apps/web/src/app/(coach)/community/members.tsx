'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useState, useTransition } from 'react';
import { CoachAvatar } from '@/components/coach-avatar';
import { ErrorText } from '@/components/ui';
import { setMemberRemoved } from './actions';
import type { Member } from './data';
import styles from './community.module.css';

/** Who is in the community. Removing someone only takes them out of the community; they stay your client. */
export function Members({ communityId, members }: { communityId: string; members: Member[] }) {
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const active = members.filter((m) => !m.removedAt);
  const removed = members.filter((m) => m.removedAt);

  const change = (m: Member, remove: boolean) => {
    if (remove && !window.confirm(`Remove ${m.name} from the community? They stay your client and keep the app; they just won't see the community.`)) return;
    startTransition(async () => {
      setError(null);
      const r = await setMemberRemoved(communityId, m.userId, remove);
      if (!r.ok) setError(r.code);
    });
  };

  return (
    <section className={styles.members} aria-labelledby="members-title">
      <h2 id="members-title" className={styles.sectionTitle}>
        Members ({active.length})
      </h2>
      <ul className={styles.memberList}>
        {active.map((m) => (
          <li key={m.userId} className={styles.member}>
            <CoachAvatar url={m.avatarUrl} name={m.name} seed={m.userId} />
            <span className={styles.memberName}>
              {m.name}
              {m.role === 'coach' ? <span className={styles.caption}> · Coach</span> : null}
            </span>
            {m.role === 'client' ? (
              <button type="button" className={styles.linkButton} disabled={pending} onClick={() => change(m, true)} aria-label={`Remove ${m.name} from the community`}>
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {removed.length > 0 ? (
        <>
          <h3 className={styles.subTitle}>Removed from the community</h3>
          <ul className={styles.memberList}>
            {removed.map((m) => (
              <li key={m.userId} className={styles.member}>
                <CoachAvatar url={m.avatarUrl} name={m.name} seed={m.userId} />
                <span className={styles.memberName}>{m.name}</span>
                <button type="button" className={styles.linkButton} disabled={pending} onClick={() => change(m, false)} aria-label={`Add ${m.name} back to the community`}>
                  Add back
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {error ? <ErrorText code={error} /> : null}
    </section>
  );
}
