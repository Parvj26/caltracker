import { ButtonLink } from '@/components/ui';

/** What a coach with no library workouts sees wherever they'd pick one (program library, "+" pickers). */
export function EmptyLibrary({ className }: { className?: string | undefined }) {
  return (
    <>
      <p className={className}>No workouts yet. A program is built from workouts in your library.</p>
      <div>
        <ButtonLink href="/workouts/new" variant="secondary">
          Create a workout
        </ButtonLink>
      </div>
    </>
  );
}
