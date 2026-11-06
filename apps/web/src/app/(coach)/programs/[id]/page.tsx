import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { DuplicateButton } from '@/components/duplicate-button';
import { DeleteProgram } from './delete-program';
import { ProgramGrid, type LibraryWorkout, type Slot } from './program-grid';
import styles from '../programs.module.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same cap as the workout library page.
const LIBRARY_LIMIT = 200;

export default async function ProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await requireCoach();
  const { id } = await params;
  const justCopied = (await searchParams).copied === '1';
  if (!UUID.test(id)) notFound();
  const supabase = await createServerSupabase();

  const [program, slots, library] = await Promise.all([
    supabase.from('programs').select('id, name, description, weeks').eq('id', id).eq('workspace_id', workspaceId).maybeSingle(),
    supabase
      .from('program_workouts')
      .select('id, week, day, position, workout_id, workouts(name)')
      .eq('program_id', id)
      .eq('workspace_id', workspaceId)
      .order('week')
      .order('day')
      .order('position'),
    supabase
      .from('workouts')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .is('client_id', null)
      .order('name')
      .limit(LIBRARY_LIMIT),
  ]);
  if (program.error) throw new Error(`Could not load the program: ${program.error.message}`);
  if (slots.error) throw new Error(`Could not load the program's workouts: ${slots.error.message}`);
  if (library.error) throw new Error(`Could not load workouts: ${library.error.message}`);
  if (!program.data) notFound();

  const initialSlots: Slot[] = slots.data.map((s) => ({
    id: s.id,
    week: s.week,
    day: s.day,
    position: s.position,
    workoutId: s.workout_id,
    workoutName: s.workouts?.name ?? '',
  }));
  const workouts: LibraryWorkout[] = library.data;

  return (
    <div className={styles.page}>
      <Link href="/programs" className={styles.back}>← Programs</Link>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>{program.data.name}</h1>
        <div className={styles.titleActions}>
          <DuplicateButton kind="program" id={program.data.id} name={program.data.name} />
          <DeleteProgram id={program.data.id} name={program.data.name} />
        </div>
      </header>
      {/* key: opening a different program starts a fresh grid. */}
      <ProgramGrid key={program.data.id} program={program.data} initialSlots={initialSlots} library={workouts} justCopied={justCopied} />
    </div>
  );
}
