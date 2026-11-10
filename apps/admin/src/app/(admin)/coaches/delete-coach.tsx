'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteConfirmMatches } from '@caltracker/shared';
import { Button, ErrorText } from '@/components/ui';
import { useActionStatus } from '@/components/confirm-dialog';
import styles from '@/components/admin.module.css';
import { libraryLine, type DeletePreview } from '@/lib/admin-coach';
import { nameOr } from '@/lib/admin-data';
import { deleteCoach, loadDeletePreview } from './actions';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Owner only. "Delete coach" on a workspace's owner row, then a dialog with what goes (counts from the database) and
 * the workspace name to type exactly. Mockup: DeleteCoach.dc.html.
 */
export function DeleteCoachButton({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const router = useRouter();
  const report = useActionStatus();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function open() {
    setTyped('');
    setError(null);
    setPreview(null);
    dialog.current?.showModal();
    const loaded = await loadDeletePreview(workspaceId);
    if (loaded.ok) setPreview(loaded.preview);
    else setError(loaded.error);
  }

  async function onSubmit() {
    setPending(true);
    setError(null);
    const result = await deleteCoach(workspaceId, typed);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    dialog.current?.close();
    report?.(result.message);
    router.refresh();
  }

  const name = preview?.workspace_name ?? workspaceName;
  const coach = nameOr(preview?.coach_name ?? '');
  const coachAccountGoes = Boolean(preview?.coach_id && preview.delete_account_ids.includes(preview.coach_id));
  const staffAccountsGo = preview ? preview.delete_account_ids.filter((id) => id !== preview.coach_id).length : 0;
  const canDelete = Boolean(preview) && !preview?.blocker && deleteConfirmMatches(typed, name);

  return (
    <>
      <button type="button" onClick={() => void open()} className={styles.dangerLink}>Delete coach</button>
      <dialog ref={dialog} aria-labelledby={titleId} className={`${styles.dialog} ${styles.dialogWide}`}>
        <form action={() => void onSubmit()} className={styles.dialogForm}>
          <h2 id={titleId} className={styles.dialogTitle}>Delete {name}?</h2>
          {preview ? (
            <>
              <div className={styles.dangerBox}>
                <b className={styles.dangerText}>This can’t be undone. It permanently deletes:</b>
                <ul className={styles.dangerList}>
                  {coachAccountGoes ? <li>{coach}’s coach account</li> : null}
                  {staffAccountsGo > 0 ? <li>{plural(staffAccountsGo, 'staff account')}</li> : null}
                  <li>{libraryLine(preview.counts)}, their custom exercises</li>
                  <li>All messages, community posts and logs in this workspace</li>
                </ul>
              </div>
              {preview.coach_id && !coachAccountGoes ? (
                <p className={styles.dialogText}>{coach} keeps their account: they also belong to another workspace.</p>
              ) : null}
              <p className={styles.dialogText}>
                <b>{plural(preview.counts.clients, 'client keeps their account', 'clients keep their accounts')}.</b>{' '}
                They get an email saying their coach closed CalTracker, and another coach can invite them later.
              </p>
              {preview.blocker ? (
                <ErrorText>{preview.blocker}</ErrorText>
              ) : (
                <label className={styles.confirmLabel}>
                  <span>Type <b>{name}</b> to confirm</span>
                  <input
                    className={styles.confirmInput}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              )}
            </>
          ) : error ? null : (
            <p className={styles.dialogText}>Counting what goes…</p>
          )}
          <p className={styles.panelNote}>This goes in the audit log.</p>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <div className={styles.dialogActions}>
            <Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>Cancel</Button>
            <Button type="submit" pending={pending} disabled={!canDelete} className={styles.dangerButton}>Delete coach</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
