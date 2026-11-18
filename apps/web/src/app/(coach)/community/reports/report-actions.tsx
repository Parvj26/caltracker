'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useState, useTransition } from 'react';
import { Button, ErrorText } from '@/components/ui';
import { resolveReport } from '../actions';
import { useConfirm } from '../use-confirm';
import styles from '../community.module.css';

export function ReportActions({ reportId, kind }: { reportId: string; kind: 'post' | 'comment' }) {
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const act = (resolution: 'removed' | 'kept') =>
    startTransition(async () => {
      setError(null);
      const r = await resolveReport(reportId, resolution);
      if (!r.ok) setError(r.code);
    });
  return (
    <div className={styles.reportActions}>
      <Button
        pending={pending}
        onClick={() => {
          confirm.ask({
            title: `Delete this ${kind}?`,
            body: `It goes for everyone in the community.`,
            confirmLabel: `Delete ${kind}`,
            onConfirm: () => resolveReport(reportId, 'removed'),
            historyId: `remove-report-${reportId}`,
          });
        }}
      >
        Remove {kind}
      </Button>
      <Button variant="secondary" pending={pending} onClick={() => act('kept')}>
        Keep it
      </Button>
      {error ? <ErrorText code={error} /> : null}
      {confirm.dialog}
    </div>
  );
}
