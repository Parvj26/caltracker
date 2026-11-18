import type { Metadata } from 'next';
import Link from 'next/link';
import { REPORT_REASON_LABELS, memberName, postAge, type ReportReason } from '@caltracker/shared';
import { Card } from '@/components/ui';
import { LiveRefresh } from '@/components/live-refresh';
import { requireCoach } from '@/lib/auth';
import { renderTime } from '@/lib/live-refresh';
import { pageTitle } from '@/lib/page-titles';
import { createServerSupabase } from '@/lib/supabase/server';
import { ReportActions } from './report-actions';
import styles from '../community.module.css';

export const metadata: Metadata = pageTitle('Reports', 'Community');

/** The coach's queue of reported posts and comments (App Store rule for user content). Open reports first. */
export default async function ReportsPage() {
  const coach = await requireCoach();
  const supabase = await createServerSupabase();
  const now = renderTime();
  const reports = await supabase
    .from('community_reports')
    .select('id, target_kind, post_id, comment_id, reporter_id, target_author_id, target_body, target_image_count, reason, note, created_at, resolved_at, resolution')
    .eq('workspace_id', coach.workspaceId)
    .order('resolved_at', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(100);
  if (reports.error) throw new Error(`Could not load reports: ${reports.error.message}`);

  const ids = [...new Set(reports.data.flatMap((r) => [r.reporter_id, r.target_author_id]).filter((x): x is string => Boolean(x)))];
  const profiles = ids.length ? await supabase.from('profiles').select('id, first_name, last_name').in('id', ids) : { data: [], error: null };
  const names = new Map((profiles.data ?? []).map((p) => [p.id, memberName({ firstName: p.first_name, lastName: p.last_name })]));
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? 'Former member') : 'Former member');
  const open = reports.data.filter((r) => !r.resolved_at);
  const closed = reports.data.filter((r) => r.resolved_at);

  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <div className={styles.titleBlock}>
          <p className={styles.caption}>
            <Link href="/community" className="tap-inline">← Community</Link>
          </p>
          <h1 className={styles.title}>Reports</h1>
          <p className={styles.caption}>Posts and comments your clients reported. Remove them, or keep them if they’re fine.</p>
        </div>
      </header>

      <section aria-labelledby="open-reports" className={styles.reportList}>
        <h2 id="open-reports" className={styles.sectionTitle}>
          Open ({open.length})
        </h2>
        {open.length === 0 ? <p className={styles.caption}>Nothing to review. 🎉</p> : null}
        {open.map((r) => (
          <Card key={r.id} className={styles.report}>
            <article aria-label={`Report about ${nameOf(r.target_author_id)}’s ${r.target_kind}`} data-testid="report">
              <p className={styles.caption}>
                {nameOf(r.reporter_id)} reported {nameOf(r.target_author_id)}’s {r.target_kind} · {postAge(r.created_at, now)}
              </p>
              <p className={styles.shareBadge}>{REPORT_REASON_LABELS[r.reason as ReportReason] ?? r.reason}</p>
              {r.note ? <p className={styles.caption}>“{r.note}”</p> : null}
              <blockquote className={styles.quote}>
                {r.target_body || <em>No text</em>}
                {r.target_image_count > 0 ? <span className={styles.caption}> · {r.target_image_count} photo(s)</span> : null}
              </blockquote>
              {(r.target_kind === 'post' && !r.post_id) || (r.target_kind === 'comment' && !r.comment_id) ? (
                <p className={styles.caption}>Already deleted.</p>
              ) : r.post_id ? (
                <p className={styles.caption}>
                  <Link href={`/community#post-${r.post_id}`}>See it in the feed</Link>
                </p>
              ) : null}
              <ReportActions reportId={r.id} kind={r.target_kind === 'comment' ? 'comment' : 'post'} />
            </article>
          </Card>
        ))}
      </section>

      {closed.length > 0 ? (
        <section aria-labelledby="closed-reports" className={styles.reportList}>
          <h2 id="closed-reports" className={styles.sectionTitle}>
            Handled
          </h2>
          {closed.map((r) => (
            <p key={r.id} className={styles.caption}>
              {nameOf(r.target_author_id)}’s {r.target_kind}: {r.resolution === 'removed' ? 'removed' : 'kept'} ·{' '}
              {REPORT_REASON_LABELS[r.reason as ReportReason] ?? r.reason}
            </p>
          ))}
        </section>
      ) : null}
      <LiveRefresh on={[{ table: 'community_reports', filter: `workspace_id=eq.${coach.workspaceId}` }]} renderedAt={now} />
    </div>
  );
}
