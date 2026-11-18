import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { NewProgramForm } from './new-program-form';
import styles from '../programs.module.css';

export const metadata: Metadata = { title: 'New program · Programs' };

export default async function NewProgramPage() {
  await requireCoach();
  return (
    <div className={styles.page}>
      <PageHeader title="New program" back={{ href: '/programs', label: 'Programs' }} />
      <NewProgramForm />
    </div>
  );
}
