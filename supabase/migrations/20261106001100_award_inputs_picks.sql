-- Pick-one groups (20261106001000) and two functions that read logs.
--
-- award_inputs (from 20261106000300) now also hands over each log block's section and pick (columns added in
-- 20261106001000), so the award-workout Edge Function rebuilds the same log doc the apps see. The shared award
-- rules count only the done sets of a pick-one group's picked option, so without the pick a choice block would
-- count nothing. Everything else is unchanged.
create or replace function public.award_inputs(p_log_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'log', jsonb_build_object('id', t.id, 'client_id', t.client_id, 'workspace_id', t.workspace_id,
      'status', t.status, 'revision', t.revision,
      'is_client', exists (select 1 from public.workspace_members m
        where m.workspace_id = t.workspace_id and m.user_id = t.client_id and m.role = 'client')),
    'time_zone', (select p.time_zone from public.profiles p where p.id = t.client_id),
    'award', (select a.result from public.awards a where a.log_id = t.id),
    'award_revision', (select a.log_revision from public.awards a where a.log_id = t.id),
    'history_version', public.award_history_version(t.client_id, t.workspace_id),
    'owned', coalesce((select jsonb_agg(jsonb_build_object('key', s.sticker_key, 'count', s.count, 'shiny', s.shiny))
      from public.sticker_awards s where s.client_id = t.client_id and s.workspace_id = t.workspace_id), '[]'::jsonb),
    'owned_total', (select coalesce(sum(s.count), 0) from public.sticker_awards s
      where s.client_id = t.client_id and s.workspace_id = t.workspace_id),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'workout_id', l.workout_id, 'name', l.name, 'status', l.status, 'started_at', l.started_at,
        'finished_at', l.finished_at, 'last_activity_at', l.last_activity_at, 'auto_finished', l.auto_finished,
        'revision', l.revision, 'notes', l.notes,
        'log_blocks', coalesce((
          select jsonb_agg(jsonb_build_object('id', b.id, 'position', b.position, 'kind', b.kind,
            'section_id', b.section_id, 'section_name', b.section_name, 'picked_exercise_id', b.picked_exercise_id,
            'log_exercises', coalesce((
              select jsonb_agg(jsonb_build_object('id', e.id, 'position', e.position, 'exercise_id', e.exercise_id,
                'planned_workout_exercise_id', e.planned_workout_exercise_id,
                'swapped_from_exercise_id', e.swapped_from_exercise_id, 'note', e.note,
                'exercises', (select jsonb_build_object('name', x.name, 'tracking_type', x.tracking_type)
                  from public.exercises x where x.id = e.exercise_id),
                'log_sets', coalesce((
                  select jsonb_agg(jsonb_build_object('id', s.id, 'position', s.position, 'set_type', s.set_type,
                    'target_reps_min', s.target_reps_min, 'target_reps_max', s.target_reps_max,
                    'target_weight_kg', s.target_weight_kg, 'target_duration_s', s.target_duration_s,
                    'target_distance_m', s.target_distance_m, 'to_failure', s.to_failure,
                    'rest_seconds', s.rest_seconds, 'actual_reps', s.actual_reps,
                    'actual_weight_kg', s.actual_weight_kg, 'actual_duration_s', s.actual_duration_s,
                    'actual_distance_m', s.actual_distance_m, 'completed_at', s.completed_at) order by s.position)
                  from public.log_sets s where s.log_exercise_id = e.id and s.completed_at is not null
                ), '[]'::jsonb)) order by e.position)
              from public.log_exercises e where e.block_id = b.id
            ), '[]'::jsonb)) order by b.position)
          from public.log_blocks b where b.log_id = l.id
        ), '[]'::jsonb)) order by l.finished_at, l.id)
      from public.workout_logs l
      where l.client_id = t.client_id and l.workspace_id = t.workspace_id and l.status = 'completed'
    ), '[]'::jsonb))
  from public.workout_logs t where t.id = p_log_id;
$$;

revoke execute on function public.award_inputs(uuid) from public, anon, authenticated;
grant execute on function public.award_inputs(uuid) to service_role;

-- recent_exercises_for_client (from 20261106000100): a pick-one group's options that were not picked were never
-- done, so they are not "recent". Everything else is unchanged.
create or replace function public.recent_exercises_for_client(p_limit int default 20)
returns table (exercise_id uuid, last_used timestamptz)
language sql stable security definer set search_path = '' as $$
  select le.exercise_id, max(l.finished_at) as last_used
  from public.workout_logs l
  join public.log_exercises le on le.log_id = l.id
  join public.log_blocks b on b.id = le.block_id
  where l.client_id = (select auth.uid())
    and l.status = 'completed'
    and (b.kind <> 'choice' or b.picked_exercise_id = le.id)
  group by le.exercise_id
  order by last_used desc, le.exercise_id
  limit least(greatest(coalesce(p_limit, 20), 0), 100);
$$;
