import type { Person } from '@/components/people-search';
import { createServerSupabase } from '@/lib/supabase/server';

/** Everyone the search box can find (emails already masked for readonly by the database). */
export async function loadPeople(): Promise<Person[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('admin_people');
  if (error) throw new Error(`Could not load people: ${error.message}`);
  return data.map((p) => ({ user_id: p.user_id, kind: p.kind, name: p.name ?? '', email: p.email ?? '', coach_name: p.coach_name ?? null }));
}
