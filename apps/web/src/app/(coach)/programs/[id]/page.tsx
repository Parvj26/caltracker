import type { Metadata } from 'next';
import { namedPageTitle } from '@/lib/page-titles';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { DeleteProgram } from './delete-program';
import { ProgramGrid, type LibraryWorkout, type Slot } from './program-grid';
import styles from '../programs.module.css';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return namedPageTitle('programs', (await params).id, 'Programs');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same cap as the workout library page.
const LIBRARY_LIMIT = 200;

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId } = await requireCoach();
  const { id } = await params;
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
          <DeleteProgram id={program.data.id} name={program.data.name} />
        </div>
      </header>
      {/* key: opening a different program starts a fresh grid. */}
      <ProgramGrid key={program.data.id} program={program.data} initialSlots={initialSlots} library={workouts} />
    </div>
  );
}
