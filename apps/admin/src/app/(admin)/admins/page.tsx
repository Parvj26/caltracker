import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/admin';

export const metadata: Metadata = { title: 'Admins' };

export default async function AdminsPage() {
  await requireAdmin('owner');
  return <h1>Admins</h1>;
}
