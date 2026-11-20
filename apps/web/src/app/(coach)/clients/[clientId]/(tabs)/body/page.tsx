import { redirect } from 'next/navigation';
import { metricsTabHref } from '@/lib/metrics-paths';

/** The tab was called Body (/body) before it became Metrics: old links and bookmarks land on Metrics, query kept. */
export default async function OldBodyTab({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientId }, query] = await Promise.all([params, searchParams]);
  const kept = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) kept.append(k, one);
  const q = kept.toString();
  redirect(`${metricsTabHref(encodeURIComponent(clientId))}${q ? `?${q}` : ''}`);
}
