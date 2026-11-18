'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useEffect, useRef, useState, useTransition } from 'react';
import { CoachAvatar } from '@/components/coach-avatar';
import { MoreMenu } from '@/components/more-menu';
import { AdaptiveDialog, Button, ErrorText, type AdaptiveDialogHandle } from '@/components/ui';
import { useHistoryLayer } from '@/lib/use-history-layer';
import { setMemberRemoved } from './actions';
import type { Member } from './data';
import styles from './community.module.css';

/**
 * "Members (10)": a button that opens who is in the community in a pop-up (a sheet on a phone), instead of a long list
 * with a Remove link on every row (UX review C#1). Remove sits in each client's ⋯ and asks first, as a step inside the
 * same pop-up. Removing someone only takes them out of the community; they stay your client.
 */
export function Members({ communityId, members }: { communityId: string; members: Member[] }) {
  const [open, setOpen] = useState(false);
  const active = members.filter((m) => !m.removedAt);
  return (
    <>
      <Button variant="secondary" size="compact" onClick={() => setOpen(true)} aria-haspopup="dialog" phSafe>
        Members ({active.length})
      </Button>
      {open ? <MembersDialog communityId={communityId} members={members} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function MembersDialog({ communityId, members, onClose }: { communityId: string; members: Member[]; onClose: () => void }) {
  const ref = useRef<AdaptiveDialogHandle>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<Member | null>(null);
  const active = members.filter((m) => !m.removedAt);
  const removed = members.filter((m) => m.removedAt);

  // "Remove …?" is its own step of history: Back (and Esc) go back to the list first, not out of the pop-up.
  useHistoryLayer({ id: 'remove-member', param: 'step', active: asking !== null, onBack: () => setAsking(null) });

  // The question takes focus when it appears (the ⋯ that asked is gone). Esc steps back to the list, before the
  // pop-up's own Esc (which would close it) sees the key.
  useEffect(() => {
    if (!asking || pending) return;
    document.getElementById('remove-member-cancel')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setAsking(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [asking, pending]);

  const change = (m: Member, remove: boolean) =>
    startTransition(async () => {
      setError(null);
      const r = await setMemberRemoved(communityId, m.userId, remove);
      if (!r.ok) setError(r.code);
      else setAsking(null);
    });

  return (
    // One pop-up for both steps (the list, then "Remove …?"), never a pop-up from a pop-up (UI rules §5.4).
    <AdaptiveDialog
      ref={ref}
      historyId="community-members"
      title={asking ? `Remove ${asking.name} from the community?` : `Members (${active.length})`}
      {...(asking ? { describedBy: 'remove-member-body' } : {})}
      onClose={onClose}
      busy={pending}
      stackFooterOnPhone
      footer={
        asking ? (
          <>
            <Button id="remove-member-cancel" variant="secondary" onClick={() => setAsking(null)} disabled={pending} phSafe>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => change(asking, true)} pending={pending} phSafe>
              {pending ? 'Removing…' : 'Remove'}
            </Button>
          </>
        ) : undefined
      }
    >
      {asking ? (
        <>
          <p id="remove-member-body">They stay your client and keep the app; they just won’t see the community.</p>
          {error ? <ErrorText code={error} /> : null}
        </>
      ) : (
      <>
      <ul className={styles.memberList} aria-label="Members">
        {active.map((m) => (
          <li key={m.userId} className={styles.member}>
            <CoachAvatar url={m.avatarUrl} name={m.name} seed={m.userId} />
            <span className={styles.memberName}>
              {m.name}
              {m.role === 'coach' ? <span className={styles.caption}> · Coach</span> : null}
            </span>
            {m.role === 'client' ? (
              <MoreMenu
                label={`More for ${m.name}`}
                disabled={pending}
                items={[{ label: 'Remove from the community…', danger: true, onSelect: () => setAsking(m) }]}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {removed.length > 0 ? (
        <>
          <h3 className={styles.subTitle}>Removed from the community</h3>
          <ul className={styles.memberList} aria-label="Removed from the community">
            {removed.map((m) => (
              <li key={m.userId} className={styles.member}>
                <CoachAvatar url={m.avatarUrl} name={m.name} seed={m.userId} />
                <span className={styles.memberName}>{m.name}</span>
                <Button variant="quiet" size="compact" disabled={pending} onClick={() => change(m, false)} aria-label={`Add ${m.name} back to the community`}>
                  Add back
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {error ? <ErrorText code={error} /> : null}
      </>
      )}
    </AdaptiveDialog>
  );
}
