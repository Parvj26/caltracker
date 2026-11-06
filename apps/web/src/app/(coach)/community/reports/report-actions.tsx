'use client';

import { useState, useTransition } from 'react';
import { Button, ErrorText } from '@/components/ui';
import { resolveReport } from '../actions';
import styles from '../community.module.css';

export function ReportActions({ reportId, kind }: { reportId: string; kind: 'post' | 'comment' }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const act = (resolution: 'removed' | 'kept') =>
    startTransition(async () => {
      setError(null);
      const r = await resolveReport(reportId, resolution);
      if (!r.ok) setError(r.error);
    });
  return (
    <div className={styles.reportActions}>
      <Button
        pending={pending}
        onClick={() => {
          if (window.confirm(`Delete this ${kind} for everyone?`)) act('removed');
        }}
      >
        Remove {kind}
      </Button>
      <Button variant="secondary" pending={pending} onClick={() => act('kept')}>
        Keep it
      </Button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
