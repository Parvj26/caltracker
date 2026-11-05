'use client';

import { useState, useTransition } from 'react';
import {
  CLIENT_CSV_MAX_ROWS,
  EMAIL_HEADERS,
  FIRST_NAME_HEADERS,
  LAST_NAME_HEADERS,
  NAME_HEADERS,
  clientCsvTemplate,
  parseClientCsv,
  type InviteInput,
} from '@caltracker/shared';
import { Button, Chip, ErrorText } from '@/components/ui';
import { sendInvites } from './actions';
import { statusView, type StatusView } from './status-copy';
import { StatusChip } from './status-chip';
import styles from './clients.module.css';

type Parsed = ReturnType<typeof parseClientCsv>;

// Built in the browser from the parser's own constants, so the example always matches what the upload accepts.
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(clientCsvTemplate())}`;

function HeaderList({ label, headers }: { label: string; headers: readonly string[] }) {
  return (
    <div className={styles.headerList}>
      <span className={styles.headerListLabel}>{label}</span>
      <ul>
        {headers.map((h) => (
          <li key={h}><Chip tone="grey">{h}</Chip></li>
        ))}
      </ul>
    </div>
  );
}

export function CsvUpload() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [statuses, setStatuses] = useState<Map<string, StatusView>>(new Map());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    // The input is disabled while sending; this guard also covers a change event that slips through,
    // so a new file can never mix with the outcomes of a send still in flight.
    if (pending) return;
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
      setStatuses((prev) => new Map([...prev, ...outcome.results.map((r): [string, StatusView] => [r.email, statusView(r.status, r.message)])]));
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
    <section className={styles.panelSection}>
      {/* Folded by default: the heading is the toggle, so the page leads with single invites. */}
      <details className={styles.csvDetails}>
      <summary className={styles.csvSummary}>
        <h2 id="csv-heading" className={styles.sectionHeading}>Invite many clients from a spreadsheet (CSV)</h2>
      </summary>
      <p id="csv-explain" className={styles.explain}>
        Bring your client list from Everfit or Excel: one row per client with first name, last name and email.
      </p>
      <p id="csv-limit" className={styles.caption}>Up to {CLIENT_CSV_MAX_ROWS} clients per file.</p>
      <div className={styles.csvHelp} id="csv-help" data-csv-headers="">
        <HeaderList label="First name column, any of:" headers={FIRST_NAME_HEADERS} />
        <HeaderList label="Last name column (optional), any of:" headers={LAST_NAME_HEADERS} />
        <HeaderList label="Or one name column, split at the first space:" headers={NAME_HEADERS} />
        <HeaderList label="Email column, any of:" headers={EMAIL_HEADERS} />
      </div>
      <div className={styles.csvActions}>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-labelledby="csv-heading"
          aria-describedby="csv-explain csv-limit csv-help"
          className={styles.fileInput}
          disabled={pending}
          onChange={(e) => void onFile(e)}
        />
        <a href={TEMPLATE_HREF} download="caltracker-clients-example.csv" className={styles.textLink}>
          Download example CSV
        </a>
      </div>
      {parsed ? (
        <>
          {parsed.errors.length > 0 ? (
            <div role="alert" className={styles.lineErrors}>
              <ul>
                {parsed.errors.map((e) => (
                  <li key={`${e.line}-${e.message}`}>
                    <span aria-hidden="true" className={styles.errorMarker}>⚠</span>
                    <span>Line {e.line}: {e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {parsed.rows.length > 0 ? (
            <>
              <div className={styles.previewScroll}>
                <table aria-label="CSV preview" className={styles.previewTable}>
                  <thead>
                    <tr><th>First name</th><th>Last name</th><th>Email</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {parsed.rows.map((r) => {
                      const view = statuses.get(r.email);
                      return (
                        <tr key={r.email}>
                          <td>{r.firstName}</td>
                          <td>{r.lastName}</td>
                          <td>{r.email}</td>
                          <td>{view ? <StatusChip view={view} /> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {statuses.size === 0 ? (
                <Button pending={pending} onClick={() => send(parsed.rows)}>
                  {pending ? 'Sending…' : `Send ${parsed.rows.length} invite${parsed.rows.length === 1 ? '' : 's'}`}
                </Button>
              ) : failed.size > 0 ? (
                <Button pending={pending} onClick={() => send(parsed.rows.filter((r) => failed.has(r.email)))}>
                  {pending ? 'Sending…' : 'Retry failed rows'}
                </Button>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      </details>
    </section>
  );
}
