'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { DeleteDialog } from '../workout-row-actions';

/**
 * The workout page's Delete workout: the same question as the Workouts list's Delete…. It refuses while a program or
 * an open invite's starting plan uses the workout. Once deleted, the list takes its place in history (replace), so Back
 * never shows the deleted workout.
 */
export function DeleteWorkout({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Delete workout
      </Button>
      {open ? <DeleteDialog id={id} name={name} onClose={() => setOpen(false)} onDeleted={() => router.replace('/workouts')} /> : null}
    </>
  );
}
