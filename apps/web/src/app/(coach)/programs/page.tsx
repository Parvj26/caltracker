import type { Metadata } from 'next';
import { CreateLink, PageHeader } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { escapeLike } from '../exercises/filters';
import { ProgramList } from './program-list';
import styles from './programs.module.css';
import { LibraryTabs } from '../library-tabs';

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
      <PageHeader
        title="Programs"
        // One line on what it is; the phone leaves it out to keep the list high (CSS).
        subtitle={<span className={styles.intro}>A program arranges workouts into weeks. Assign it to a client and every workout lands on their calendar.</span>}
        action={<CreateLink href="/programs/new" thing="program" data-ph-capture-attribute-label="program_new" />} />
      <LibraryTabs current="/programs" />

      <ProgramList rows={rows} total={counted.count ?? found.length} initialQuery={q} limited={limited} limit={LIMIT} />
    </div>
  );
}
