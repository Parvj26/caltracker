import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/admin';

export const metadata: Metadata = { title: 'Overview' };

export default async function OverviewPage() {
  await requireAdmin();
  return <h1>Overview</h1>;
}
