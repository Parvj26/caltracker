'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { awardSession } from '../../log/[workoutId]/actions';

/**
 * Right after the coach finishes a session (?award=1): asks for the client's stickers, PRs and streaks, as the phone
 * does after its own finish, then shows the page again without the flag (with its PR chip). The coach is never held
 * up: the page is already open, and if this fails the catch-up job awards the log within 15 minutes.
 */
export function AwardKickoff({ logId }: { logId: string }) {
  const router = useRouter();
  const path = usePathname();
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void awardSession(logId)
      .catch(() => undefined)
      .finally(() => router.replace(path));
  }, [logId, path, router]);
  return null;
}
