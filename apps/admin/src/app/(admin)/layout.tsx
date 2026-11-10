import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin-shell';
import { requireAdmin } from '@/lib/admin';
import { isProductionEnv } from '@/lib/roles';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  return (
    <AdminShell name={admin.name} role={admin.role} staging={!isProductionEnv(process.env.NEXT_PUBLIC_APP_ENV)}>
      {children}
    </AdminShell>
  );
}
