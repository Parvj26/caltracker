'use client';

import { useState, useTransition } from 'react';
import { parseClientCsv, type InviteInput } from '@caltracker/shared';
import { sendInvites } from './actions';
import { statusCopy } from './status-copy';
import styles from './clients.module.css';

type Parsed = ReturnType<typeof parseClientCsv>;

export function CsvUpload() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [statuses, setStatuses] = useState<Map<string, string>>(new Map());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setStatuses(new Map());
    setFailed(new Set());
    setError(null);
    if (!file) return setParsed(null);
    setParsed(parseClientCsv(await file.text()));
  }

  function send(rows: InviteInput[]) {
    setError(null);
    startTransition(async () => {
      const outcome = await sendInvites(rows);
      if (!outcome.ok) return setError(outcome.error);
      // Merge, so a retry of the failed rows keeps the results of the rows that already went through.
      setStatuses((prev) => new Map([...prev, ...outcome.results.map((r): [string, string] => [r.email, statusCopy(r.status, r.message)])]));
      setFailed((prev) => {
        const next = new Set(prev);
        for (const r of outcome.results) {
          if (r.status === 'error') next.add(r.email);
          else next.delete(r.email);
        }
        return next;
      });
    });
  }

  return (
    <section>
      <h2>Upload CSV</h2>
      <label className={styles.fileLabel}>
        Upload CSV
        <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e)} />
      </label>
      <p className={styles.hint}>Columns: Name, Email. Up to 200 clients.</p>
      {parsed ? (
        <>
          {parsed.errors.length > 0 ? (
            <ul className={styles.error}>
              {parsed.errors.map((e) => (
                <li key={`${e.line}-${e.message}`}>Line {e.line}: {e.message}</li>
              ))}
            </ul>
          ) : null}
          {parsed.rows.length > 0 ? (
            <>
              <table aria-label="CSV preview" className={styles.table}>
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {parsed.rows.map((r) => (
                    <tr key={r.email}>
                      <td>{r.fullName}</td>
                      <td>{r.email}</td>
                      <td>{statuses.get(r.email) ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {statuses.size === 0 ? (
                <button type="button" disabled={pending} onClick={() => send(parsed.rows)}>
                  {pending ? 'Sending…' : `Send ${parsed.rows.length} invite${parsed.rows.length === 1 ? '' : 's'}`}
                </button>
              ) : failed.size > 0 ? (
                <button type="button" disabled={pending} onClick={() => send(parsed.rows.filter((r) => failed.has(r.email)))}>
                  {pending ? 'Sending…' : 'Retry failed rows'}
                </button>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </section>
  );
}
