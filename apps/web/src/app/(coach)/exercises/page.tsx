import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TRACKING_TYPES } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { EQUIPMENT, MUSCLES, TRACKING_LABELS, escapeLike } from './filters';
import { Button, ButtonLink, Card, Chip, SelectField, TextField } from '@/components/ui';
import { TrackingChips } from './tracking-chips';
import styles from './exercises.module.css';

const PAGE_SIZE = 50;
const MAX_PAGE = 10_000;

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function ExercisesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireCoach();
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const muscle = one(sp.muscle);
  const equipment = one(sp.equipment);
  const tracking = one(sp.tracking);
  const source = one(sp.source);
  const rawPage = /^\d{1,9}$/.test(one(sp.page)) ? Number.parseInt(one(sp.page), 10) : 1;
  const page = Math.min(MAX_PAGE, Math.max(1, rawPage));

  const supabase = await createServerSupabase();
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, muscle, equipment, tracking, source })) if (v) params.set(k, v);
    if (p > 1) params.set('page', String(p));
    const s = params.toString();
    return s ? `/exercises?${s}` : '/exercises';
  };

  function build(head: boolean) {
    let query = supabase
      .from('exercises')
      .select('id, name, primary_muscles, image_paths, tracking_type', { count: 'exact', head });
    if (q) query = query.ilike('name', `%${escapeLike(q)}%`);
    if ((MUSCLES as readonly string[]).includes(muscle)) query = query.contains('primary_muscles', [muscle]);
    if ((EQUIPMENT as readonly string[]).includes(equipment)) query = query.eq('equipment', equipment);
    if ((TRACKING_TYPES as readonly string[]).includes(tracking)) {
      query = query.eq('tracking_type', tracking as (typeof TRACKING_TYPES)[number]);
    }
    if (source === 'builtin' || source === 'custom') query = query.eq('source', source);
    return query;
  }

  const { data, count, error, status } = await build(false)
    .order('name', { ascending: true })
    .order('id', { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error && page > 1 && (error.code === 'PGRST103' || status === 416)) {
    // Requested page is past the end: redirect to the last page (page 1 when nothing matches).
    const head = await build(true);
    redirect(href(Math.max(1, Math.ceil((head.count ?? 0) / PAGE_SIZE))));
  }
  if (error) throw new Error(`Could not load exercises: ${error.message}`);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={styles.page}>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>Exercises</h1>
        <p className={styles.caption}>
          {total} exercise{total === 1 ? '' : 's'}
        </p>
        <ButtonLink href="/exercises/new" className={styles.newButton}>
          New custom exercise
        </ButtonLink>
      </header>

      <Card className={styles.filterCard}>
        <form className={styles.filters} method="get" action="/exercises">
          <div className={styles.searchRow}>
            <TextField label="Search" type="search" name="q" defaultValue={q} className={styles.searchField} />
            <Button type="submit" className={styles.searchButton}>Search</Button>
          </div>
          <div className={styles.selectRow}>
            <SelectField label="Muscle" name="muscle" defaultValue={muscle}>
              <option value="">Any</option>
              {MUSCLES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </SelectField>
            <SelectField label="Equipment" name="equipment" defaultValue={equipment}>
              <option value="">Any</option>
              {EQUIPMENT.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </SelectField>
            <SelectField label="Show" name="source" defaultValue={source}>
              <option value="">All</option>
              <option value="builtin">Built-in</option>
              <option value="custom">My exercises</option>
            </SelectField>
          </div>
          <TrackingChips initial={(TRACKING_TYPES as readonly string[]).includes(tracking) ? tracking : ''} />
        </form>
      </Card>

      {data.length === 0 ? (
        <p className={styles.empty}>No exercises match.</p>
      ) : (
        <ul className={styles.grid}>
          {data.map((ex) => {
            const first = ex.image_paths[0];
            const src = first ? supabase.storage.from('exercise-images').getPublicUrl(first).data.publicUrl : null;
            return (
              <li key={ex.id}>
                <Link href={`/exercises/${ex.id}`} className={styles.card}>
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- plain img keeps the app host-agnostic (no image optimizer)
                    <img src={src} alt="" width={180} height={120} loading="lazy" className={styles.thumb} />
                  ) : (
                    <div className={styles.thumbPlaceholder} />
                  )}
                  <strong className={styles.cardName}>{ex.name}</strong>
                  <span className={styles.muted}>{ex.primary_muscles.join(', ')}</span>
                  <Chip tone="grey" className={styles.cardChip}>{TRACKING_LABELS[ex.tracking_type]}</Chip>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav className={styles.pager} aria-label="Pagination">
          {page > 1 ? <ButtonLink variant="secondary" href={href(page - 1)}>Previous</ButtonLink> : null}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages ? <ButtonLink variant="secondary" href={href(page + 1)}>Next</ButtonLink> : null}
        </nav>
      ) : null}
    </div>
  );
}
