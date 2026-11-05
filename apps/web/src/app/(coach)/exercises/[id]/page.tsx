import { notFound } from 'next/navigation';
import { parseYoutubeUrl, youtubeFormSearchUrl } from '@caltracker/shared';
import { ButtonLink, Card, Chip } from '@/components/ui';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { ExerciseForm } from '../exercise-form';
import { TRACKING_LABELS } from '../filters';
import styles from '../exercises.module.css';
import { OverrideForm } from './override-form';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const { workspaceId } = await requireCoach();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createServerSupabase();
  const [exercise, override] = await Promise.all([
    supabase.from('exercises').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('exercise_overrides')
      .select('youtube_url, coach_notes')
      .eq('exercise_id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ]);
  if (exercise.error) throw new Error(`Could not load exercise: ${exercise.error.message}`);
  if (override.error) throw new Error(`Could not load exercise notes: ${override.error.message}`);
  const ex = exercise.data;
  if (!ex) notFound();

  const isCustom = ex.source === 'custom';
  const pinned = override.data?.youtube_url ?? ex.youtube_url;
  const videoId = pinned ? parseYoutubeUrl(pinned)?.videoId : undefined;
  const imageUrl = (path: string) => supabase.storage.from('exercise-images').getPublicUrl(path).data.publicUrl;

  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>{ex.name}</h1>
        <Chip tone="lime">{TRACKING_LABELS[ex.tracking_type]}</Chip>
      </header>

      <Card>
        <dl className={styles.meta}>
          <dt>Tracking type</dt>
          <dd>{TRACKING_LABELS[ex.tracking_type]}</dd>
          <dt>Primary muscles</dt>
          <dd>{ex.primary_muscles.join(', ') || 'None listed'}</dd>
          <dt>Equipment</dt>
          <dd>{ex.equipment ?? 'None'}</dd>
        </dl>

        {ex.image_paths.length > 0 ? (
          <div className={styles.images}>
            {ex.image_paths.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element -- plain img keeps the app host-agnostic (no image optimizer)
              <img key={p} src={imageUrl(p)} alt={`${ex.name} demonstration`} width={240} height={160} loading="lazy" />
            ))}
          </div>
        ) : null}
      </Card>

      {ex.instructions.length > 0 ? (
        <Card>
          <section>
            <h2 className={styles.sectionHeading}>Instructions</h2>
            <ol className={styles.steps}>
              {ex.instructions.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </section>
        </Card>
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
                trackingType: ex.tracking_type,
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
