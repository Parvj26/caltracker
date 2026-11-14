import type { Metadata } from 'next';
import Link from 'next/link';
import { exercisePageTitle } from '@/lib/page-titles';
import { getExercise } from '@/lib/page-data';
import { notFound } from 'next/navigation';
import { parseYoutubeUrl, toLibraryTrackingType, toTrackingType, youtubeFormSearchUrl } from '@caltracker/shared';
import { ButtonLink, Card, Chip } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { ExerciseForm } from '../exercise-form';
import { TRACKING_LABELS } from '../filters';
import styles from '../exercises.module.css';
import { DetailStar } from './detail-star';
import { OverrideForm } from './override-form';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return exercisePageTitle((await params).id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId, userId } = await requireCoach();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createServerSupabase();
  const [exercise, override, favourite] = await Promise.all([
    getExercise(id),
    supabase
      .from('exercise_overrides')
      .select('youtube_url, coach_notes')
      .eq('exercise_id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    supabase.from('exercise_favorites').select('exercise_id').eq('exercise_id', id).eq('coach_id', userId).maybeSingle(),
  ]);
  if (override.error) throw new Error(`Could not load exercise notes: ${override.error.message}`);
  const ex = exercise;
  if (!ex) notFound();

  const isCustom = ex.source === 'custom';
  const pinned = override.data?.youtube_url ?? ex.youtube_url;
  const videoId = pinned ? parseYoutubeUrl(pinned)?.videoId : undefined;
  const imageUrl = (path: string) => supabase.storage.from('exercise-images').getPublicUrl(path).data.publicUrl;

  const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const trackingLabel = TRACKING_LABELS[toTrackingType(ex.tracking_type)];
  const secondary = ex.secondary_muscles.filter((m) => !ex.primary_muscles.includes(m));

  // Approved phone mockup (row 5): a full-screen page with ‹ Exercises and the star in a top bar that sticks, then the
  // name, "tracking · equipment", the photos, the muscles and the steps. Wider screens show the same, unstuck.
  return (
    <div className={styles.page}>
      <div className={styles.detailBar}>
        <Link href="/exercises" className={styles.back} aria-label="Back to exercises">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Exercises
        </Link>
        <DetailStar id={ex.id} name={ex.name} initial={favourite.data !== null} />
      </div>

      <header className={styles.detailHead}>
        <h1 className={styles.title}>{ex.name}</h1>
        <p className={styles.detailCaption}>
          {trackingLabel}
          {ex.equipment ? ` · ${capital(ex.equipment)}` : ''}
          {isCustom ? ' · Custom' : ''}
        </p>
      </header>

      {ex.image_paths.length > 0 ? (
        <div className={styles.images}>
          {ex.image_paths.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element -- plain img keeps the app host-agnostic (no image optimizer)
            <img key={p} src={imageUrl(p)} alt={`${ex.name} demonstration`} width={240} height={160} loading="lazy" />
          ))}
        </div>
      ) : null}

      <section className={styles.detailSection} aria-labelledby="muscles-heading">
        <h2 id="muscles-heading" className={styles.detailHeading}>
          Muscles
        </h2>
        {ex.primary_muscles.length + secondary.length > 0 ? (
          <div className={styles.muscleChips}>
            {ex.primary_muscles.map((m) => (
              <Chip key={m} tone="blue">
                {capital(m)}
              </Chip>
            ))}
            {secondary.map((m) => (
              <Chip key={m} tone="grey">
                {capital(m)}
              </Chip>
            ))}
          </div>
        ) : (
          <p className={styles.notes}>None listed</p>
        )}
      </section>

      {ex.instructions.length > 0 ? (
        <section className={styles.detailSection} aria-labelledby="steps-heading">
          <h2 id="steps-heading" className={styles.detailHeading}>
            How to do it
          </h2>
          <ol className={styles.steps}>
            {ex.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </section>
      ) : null}

      <Card>
        <section>
          <h2 className={styles.sectionHeading}>Video</h2>
          {videoId ? (
            <iframe
              className={styles.video}
              src={`https://www.youtube-nocookie.com/embed/${videoId}`}
              title={`${ex.name} form video`}
              allow="encrypted-media; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          ) : (
            <ButtonLink
              variant="secondary"
              href={youtubeFormSearchUrl(ex.name)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Watch form on YouTube
            </ButtonLink>
          )}
        </section>
      </Card>

      {!isCustom && override.data?.coach_notes ? (
        <Card>
          <section>
            <h2 className={styles.sectionHeading}>Your notes</h2>
            <p className={styles.notes}>{override.data.coach_notes}</p>
          </section>
        </Card>
      ) : null}

      <Card>
        <section>
          <h2 className={styles.sectionHeading}>{isCustom ? 'Edit exercise' : 'Your video and notes'}</h2>
          {isCustom ? (
            <ExerciseForm
              exerciseId={ex.id}
              initial={{
                name: ex.name,
                trackingType: toLibraryTrackingType(ex.tracking_type),
                primaryMuscles: ex.primary_muscles,
                equipment: ex.equipment,
                instructions: ex.instructions,
                youtubeUrl: ex.youtube_url,
              }}
            />
          ) : (
            <OverrideForm
              exerciseId={ex.id}
              youtubeUrl={override.data?.youtube_url ?? null}
              coachNotes={override.data?.coach_notes ?? null}
            />
          )}
        </section>
      </Card>
    </div>
  );
}
