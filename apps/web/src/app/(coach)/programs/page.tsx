import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { escapeLike } from '../exercises/filters';
import { ProgramList } from './program-list';
import styles from './programs.module.css';

export const metadata: Metadata = { title: 'Programs' };

// Program lists stay small in V1; past this the list says so instead of paging.
const LIMIT = 200;

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function ProgramsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workspaceId } = await requireCoach();
  const q = one((await searchParams).q).trim().slice(0, 100);
  const supabase = await createServerSupabase();
  const programs = () => supabase.from('programs').select('id, name, weeks, program_workouts(count)').eq('workspace_id', workspaceId);
  // The list filters in the browser with the shared smart search (typos forgiven), as you type, over the most recent
  // LIMIT. A bigger list also gets the plain name match from the server for a submitted search (?q=), so an older
  // program can still be found by its name.
  const [{ data, error }, counted] = await Promise.all([
    programs().order('updated_at', { ascending: false }).limit(LIMIT + 1),
    supabase.from('programs').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
  ]);
  if (error) throw new Error(`Could not load programs: ${error.message}`);
  const limited = data.length > LIMIT;
  const found = data.slice(0, LIMIT);
  if (limited && q) {
    const older = await programs().ilike('name', `%${escapeLike(q)}%`).order('updated_at', { ascending: false }).limit(LIMIT);
    if (older.error) throw new Error(`Could not search programs: ${older.error.message}`);
    const seen = new Set(found.map((p) => p.id));
    found.push(...older.data.filter((p) => !seen.has(p.id)));
  }
  const rows = found.map((p) => ({
    id: p.id,
    name: p.name,
    weeks: p.weeks,
    slots: p.program_workouts[0]?.count ?? 0,
  }));

  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Programs</h1>
          <p className={`${styles.caption} ${styles.listIntro}`}>
            A program arranges workouts into weeks. Assign it to a client and every workout lands on their calendar.
          </p>
        </div>
        <div className={styles.titleActions}>
          {/* Phones: a small outlined "+ New" (named "New program" for screen readers). */}
          <ButtonLink href="/programs/new" className={styles.newButton} aria-label="New program" data-ph-capture-attribute-label="program_new">
            <span aria-hidden="true" className={styles.phoneOnly}>+&nbsp;</span>New<span className={styles.newWord}> program</span>
          </ButtonLink>
        </div>
      </header>

      <ProgramList rows={rows} total={counted.count ?? found.length} initialQuery={q} limited={limited} limit={LIMIT} />
    </div>
  );
}
