'use client';

import { useRef, useState, useTransition } from 'react';
import { DOCUMENT_NAME_MAX_LENGTH, documentKind, formatFileSize } from '@caltracker/shared';
import { LocalDate } from '@/app/(coach)/workouts/local-date';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { failureMessage, isStaleDeployError } from '@/lib/action-errors';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { createDocument, deleteDocument, documentLink, renameDocument, setDocumentShared, type DocumentOutcome } from '../documents-actions';
import { preparePrintout, type Printout } from '../progress/compress';
import styles from './documents.module.css';

export type DocumentRow = { id: string; name: string; kind: 'PDF' | 'Image'; sizeBytes: number; shared: boolean; createdAt: string };

const FILE_ERROR = 'Choose a PDF under 5 MB or an image. Videos and other files can’t be added.';
const ACCEPT = 'application/pdf,image/*';

/** The file name without its extension, as a starting name. */
const baseName = (file: File) => file.name.replace(/\.[^.]+$/, '').slice(0, DOCUMENT_NAME_MAX_LENGTH);

function UploadCard({ workspaceId, clientId, firstName, onMessage }: { workspaceId: string; clientId: string; firstName: string; onMessage: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ prepared: Printout; original: File } | null>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [pending, start] = useTransition();

  async function choose(f: File | undefined) {
    setError(null);
    setFile(null);
    if (!f) return;
    if (!documentKind(f.type, f.size)) {
      setError(FILE_ERROR);
      if (input.current) input.current.value = '';
      return;
    }
    setPreparing(true);
    try {
      // Images are shrunk on this device (1600 px long edge, WebP or JPEG); PDFs are kept as they are.
      setFile({ prepared: await preparePrintout(f, FILE_ERROR), original: f });
      setName((n) => n || baseName(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : FILE_ERROR);
      if (input.current) input.current.value = '';
    } finally {
      setPreparing(false);
    }
  }

  function upload() {
    if (!file) return;
    setError(null);
    start(async () => {
      const id = crypto.randomUUID();
      const path = `${workspaceId}/${clientId}/${crypto.randomUUID()}.${file.prepared.ext}`;
      let uploaded = false;
      try {
        const up = await createBrowserSupabase().storage.from('client-documents').upload(path, file.prepared.blob, { contentType: file.prepared.contentType });
        if (up.error) {
          setError("Couldn't upload the file. Check your connection and try again.");
          return;
        }
        uploaded = true;
        const outcome = await createDocument({ id, clientId, name, path, contentType: file.prepared.contentType, sizeBytes: file.prepared.blob.size, shared });
        uploaded = false; // saved, or the server already took the file back
        if (!outcome.ok) {
          setError(outcome.warning ? `${outcome.error} ${outcome.warning}` : outcome.error);
          return;
        }
        setFile(null);
        setName('');
        setShared(false);
        if (input.current) input.current.value = '';
        onMessage(`Added ${name.trim()}.`);
      } catch (e) {
        // The record may have been saved even though the answer never arrived, so the file stays (a leftover file
        // beats a document whose file is gone). Only a call that certainly never ran (a stale page) takes it back.
        if (!isStaleDeployError(e)) uploaded = false;
        setError(failureMessage(e, "Couldn't save the document. Check your connection and try again."));
      } finally {
        if (uploaded) void createBrowserSupabase().storage.from('client-documents').remove([path]);
      }
    });
  }

  return (
    <Card className={styles.card} aria-labelledby="upload-heading">
      <h2 id="upload-heading" className={styles.heading}>Add a document</h2>
      <p className={styles.caption}>A PDF (up to 5 MB) or a photo. Photos are made smaller before upload. No videos.</p>
      <label className={styles.fileLabel}>
        <span className={styles.fieldLabel}>File</span>
        <input ref={input} type="file" accept={ACCEPT} className={styles.file} onChange={(e) => void choose(e.target.files?.[0])} disabled={pending} />
      </label>
      {preparing ? <p className={styles.caption} role="status">Getting the file ready…</p> : null}
      {file ? (
        <>
          <p className={styles.caption}>
            {file.prepared.ext === 'pdf' ? 'PDF' : 'Image'} · {formatFileSize(file.prepared.blob.size)}
          </p>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={DOCUMENT_NAME_MAX_LENGTH} required />
          <label className={styles.check}>
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>Share with {firstName} (they can open it in the app)</span>
          </label>
        </>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className={styles.actions}>
        <Button onClick={upload} pending={pending} disabled={!file || !name.trim() || preparing}>
          {pending ? 'Uploading…' : 'Upload'}
        </Button>
      </div>
    </Card>
  );
}

function DocumentItem({ doc, firstName, readOnly, onMessage }: { doc: DocumentRow; firstName: string; readOnly: boolean; onMessage: (m: string) => void }) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(doc.name);
  // The switch moves at once; it goes back if the save fails.
  const [shared, setShared] = useState(doc.shared);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(action: () => Promise<DocumentOutcome>, done: string, after?: () => void, undo?: () => void) {
    setError(null);
    start(async () => {
      try {
        const outcome = await action();
        if (!outcome.ok) {
          undo?.();
          setError(outcome.error);
        } else {
          after?.();
          onMessage(outcome.warning ?? done);
        }
      } catch (e) {
        undo?.();
        setError(failureMessage(e, "Couldn't save. Check your connection and try again."));
      }
    });
  }

  const [opening, setOpening] = useState(false);
  /** Links are made when asked for (and last 5 minutes), so a page left open never hands out a stale or long-lived one. */
  async function open() {
    setError(null);
    setOpening(true);
    // Open the tab now, while the click still counts as the coach's own action (popup blockers), then point it there.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const link = await documentLink(doc.id);
      if (link.ok && tab) tab.location.href = link.url;
      else if (link.ok) window.location.href = link.url;
      else {
        tab?.close();
        setError(link.error);
      }
    } catch (e) {
      tab?.close();
      setError(failureMessage(e, "Couldn't open the document. Check your connection and try again."));
    } finally {
      setOpening(false);
    }
  }

  function share(next: boolean) {
    setShared(next);
    run(() => setDocumentShared(doc.id, next), next ? `Shared with ${firstName}.` : 'No longer shared.', undefined, () => setShared(!next));
  }

  return (
    <li className={styles.item}>
      <div className={styles.itemMain}>
        {renaming ? (
          <form
            className={styles.rename}
            onSubmit={(e) => {
              e.preventDefault();
              run(() => renameDocument(doc.id, name), 'Renamed.', () => setRenaming(false));
            }}
          >
            <TextField label="Document name" value={name} onChange={(e) => setName(e.target.value)} maxLength={DOCUMENT_NAME_MAX_LENGTH} autoFocus required />
            <div className={styles.actions}>
              <Button type="submit" pending={pending}>Save</Button>
              <Button variant="secondary" onClick={() => setRenaming(false)} disabled={pending}>Cancel</Button>
            </div>
          </form>
        ) : (
          <button type="button" className={styles.nameButton} onClick={() => void open()} disabled={opening}>
            {doc.name}
            <span className={styles.visuallyHidden}> (opens in a new tab)</span>
          </button>
        )}
        <span className={styles.caption}>
          {doc.kind} · {formatFileSize(doc.sizeBytes)} · <LocalDate iso={doc.createdAt} />
          {shared ? ` · Shared with ${firstName}` : ' · Only you'}
        </span>
      </div>
      {readOnly && shared ? (
        <div className={styles.actions}>
          <label className={styles.check}>
            <input type="checkbox" checked disabled={pending} onChange={() => share(false)} aria-label={`Stop sharing ${doc.name} with ${firstName}`} />
            <span aria-hidden="true">Shared</span>
          </label>
        </div>
      ) : null}
      {readOnly || renaming ? null : confirming ? (
        <div className={styles.actions} role="group" aria-label={`Delete ${doc.name}?`}>
          <span className={styles.caption}>Delete {doc.name}?</span>
          <button type="button" className={styles.textButton} disabled={pending} onClick={() => run(() => deleteDocument(doc.id), `Deleted ${doc.name}.`)}>
            {pending ? 'Deleting…' : 'Delete'}
          </button>
          <button type="button" className={styles.textButton} onClick={() => setConfirming(false)}>Keep</button>
        </div>
      ) : (
        <div className={styles.actions}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={shared}
              disabled={pending}
              onChange={(e) => share(e.target.checked)}
              aria-label={`Share ${doc.name} with ${firstName}`}
            />
            <span aria-hidden="true">Shared</span>
          </label>
          <button type="button" className={styles.textButton} aria-label={`Rename ${doc.name}`} onClick={() => { setName(doc.name); setRenaming(true); }}>
            Rename
          </button>
          <button type="button" className={styles.textButton} aria-label={`Delete ${doc.name}`} onClick={() => setConfirming(true)}>
            Delete
          </button>
        </div>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </li>
  );
}

/** The Documents tab: add a PDF or image, then open, rename, share or delete it. A removed client's are read-only. */
export function DocumentsView({
  workspaceId,
  client,
  documents,
  readOnly,
}: {
  workspaceId: string;
  client: { id: string; firstName: string };
  documents: DocumentRow[];
  readOnly: boolean;
}) {
  const [message, setMessage] = useState('');
  return (
    <div className={styles.layout}>
      {readOnly ? null : <UploadCard workspaceId={workspaceId} clientId={client.id} firstName={client.firstName} onMessage={setMessage} />}
      <Card className={styles.card} aria-labelledby="documents-heading">
        <h2 id="documents-heading" className={styles.heading}>Documents</h2>
        <p role="status" className={styles.status}>{message}</p>
        {documents.length === 0 ? (
          <p className={styles.caption}>No documents yet.</p>
        ) : (
          <ul className={styles.list} aria-label="Documents, newest first">
            {documents.map((d) => (
              <DocumentItem key={d.id} doc={d} firstName={client.firstName} readOnly={readOnly} onMessage={setMessage} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
