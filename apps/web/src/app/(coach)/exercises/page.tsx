import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TRACKING_TYPES } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { EQUIPMENT, MUSCLES, TRACKING_LABELS, escapeLike } from './filters';
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
      .select('id, name, primary_muscles, image_paths', { count: 'exact', head });
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
    <div>
      <h1>Exercises</h1>
      <p>
        <Link href="/exercises/new" className={styles.button}>
          New custom exercise
        </Link>
      </p>
      <form className={styles.filters} method="get" action="/exercises">
        <label>
          Search
          <input type="search" name="q" defaultValue={q} />
        </label>
        <label>
          Muscle
          <select name="muscle" defaultValue={muscle}>
            <option value="">Any</option>
            {MUSCLES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Equipment
          <select name="equipment" defaultValue={equipment}>
            <option value="">Any</option>
            {EQUIPMENT.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tracking type
          <select name="tracking" defaultValue={tracking}>
            <option value="">Any</option>
            {TRACKING_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRACKING_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Show
          <select name="source" defaultValue={source}>
            <option value="">All</option>
            <option value="builtin">Built-in</option>
            <option value="custom">My exercises</option>
          </select>
        </label>
        <button type="submit">Search</button>
      </form>

      <p className={styles.muted}>
        {total} exercise{total === 1 ? '' : 's'}
      </p>
      {data.length === 0 ? (
        <p>No exercises match.</p>
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
                    <img src={src} alt="" width={180} height={120} loading="lazy" />
                  ) : (
                    <div className={styles.thumbPlaceholder} />
                  )}
                  <strong>{ex.name}</strong>
                  <span className={styles.muted}>{ex.primary_muscles.join(', ')}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav className={styles.pager} aria-label="Pagination">
          {page > 1 ? <Link href={href(page - 1)}>Previous</Link> : null}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={href(page + 1)}>Next</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
