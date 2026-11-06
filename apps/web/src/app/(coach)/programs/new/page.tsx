import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCoach } from '@/lib/auth';
import { NewProgramForm } from './new-program-form';
import styles from '../programs.module.css';

export const metadata: Metadata = { title: 'New program · Programs' };

export default async function NewProgramPage() {
  await requireCoach();
  return (
    <div className={styles.page}>
      <Link href="/programs" className={styles.back}>← Programs</Link>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>New program</h1>
      </header>
      <NewProgramForm />
    </div>
  );
}
