import { ButtonLink } from '@/components/ui';

/**
 * What a coach with no library workouts sees wherever they'd pick one. On a program (`forProgram`) it also says why
 * the library matters there.
 */
export function EmptyLibrary({ className, forProgram = false }: { className?: string | undefined; forProgram?: boolean }) {
  return (
    <>
      <p className={className}>
        {forProgram ? 'No workouts yet. A program is built from workouts in your library.' : 'No workouts yet.'}
      </p>
      <div>
        <ButtonLink href="/workouts/new" variant="secondary">
          Create a workout
        </ButtonLink>
      </div>
    </>
  );
}
