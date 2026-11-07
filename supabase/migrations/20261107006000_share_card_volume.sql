-- Shared workout cards say how much was lifted ("Vaishali lifted 1,540 lb — about as much as 1 cow"), product owner
-- 2026-11-07. The database still never adds up volume: award-workout works it out with the shared logVolumeKg and
-- stores it in awards.result as volumeKg, and the card copies it from there. The phone still sends only which
-- workout to share (build_community_card refuses any other key), so a card's numbers can't be made up.
--
-- apply_award (from 20261107002000): a recompute also refreshes result.volumeKg. Everything else is unchanged.
-- build_community_card (from 20261106013000): a workout card carries volumeKg from the stored award, or null when the
-- award has none (stored before this change: those cards keep the older look, without the weight). Everything else
-- is unchanged.
-- preview_community_card (new): the card a share would post, built the same way, so the composer can show it before
-- posting. Only for a community the caller can see, about the caller's own stickers and workouts; it writes nothing.

create or replace function public.apply_award(p_log_id uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_log public.workout_logs%rowtype;
  v_mode text := p_result ->> 'mode';
  v_existing jsonb;
  v_existing_revision integer;
  v_result jsonb;
  v_status text;
  v_stats jsonb := p_result -> 'stats';
  v_old_key text;
  v_new_key text;
  v_multiple jsonb;
  v_row public.sticker_awards%rowtype;
  v_is_new boolean;
begin
  if v_mode is null or v_mode not in ('award', 'recompute')
    or p_result ->> 'history_version' is null
    or jsonb_typeof(p_result -> 'award') is distinct from 'object'
    or jsonb_typeof(p_result -> 'stickers') is distinct from 'array'
    or jsonb_typeof(p_result -> 'records') is distinct from 'array'
    or jsonb_typeof(v_stats) is distinct from 'object' then
    raise exception 'apply_award needs a mode, a history version, an award, stickers, records and stats.'
      using errcode = '22023';
  end if;

  -- One award per log, even when the phone and the catch-up job call at the same moment: the second waits here,
  -- then finds the first one's row.
  perform pg_advisory_xact_lock(hashtextextended('award:' || p_log_id::text, 0));

  select * into v_log from public.workout_logs l where l.id = p_log_id;
  if not found then
    raise exception 'Workout log % not found.', p_log_id using errcode = 'P0002';
  end if;
  if v_log.status <> 'completed' then
    raise exception 'Only finished workouts earn awards.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.workspace_members m
      where m.workspace_id = v_log.workspace_id and m.user_id = v_log.client_id and m.role = 'client') then
    raise exception 'You are no longer a client of this coach.' using errcode = '42501', hint = 'not_a_client';
  end if;

  -- Awards for different logs of one client write the same sticker, best and stats rows: one at a time.
  perform pg_advisory_xact_lock(hashtextextended('award-client:' || v_log.client_id::text, 0));

  select a.result, a.log_revision into v_existing, v_existing_revision
  from public.awards a where a.log_id = p_log_id;

  if v_existing is not null and v_mode = 'award' and v_existing_revision = v_log.revision then
    return jsonb_build_object('status', 'existing', 'result', v_existing);
  end if;

  -- The bests and stats below are rebuilt from the logs: refuse if they changed since they were read.
  if public.award_history_version(v_log.client_id, v_log.workspace_id) is distinct from p_result ->> 'history_version' then
    return jsonb_build_object('status', 'conflict');
  end if;

  if v_existing is null then
    if (select coalesce(sum(s.count), 0) from public.sticker_awards s
        where s.client_id = v_log.client_id and s.workspace_id = v_log.workspace_id)
        is distinct from (p_result ->> 'owned_total')::bigint then
      return jsonb_build_object('status', 'conflict');
    end if;

    insert into public.sticker_awards as cur (client_id, workspace_id, sticker_key, shiny, first_log_id)
    select v_log.client_id, v_log.workspace_id, s.key, coalesce(s.shiny, false), v_log.id
    from jsonb_to_recordset(p_result -> 'stickers') as s(key text, shiny boolean)
    on conflict (client_id, workspace_id, sticker_key) do update
      set count = cur.count + 1,
          shiny = cur.shiny or excluded.shiny,
          last_earned_at = now();

    v_result := p_result -> 'award';
    insert into public.awards (log_id, client_id, workspace_id, result, log_revision)
    values (v_log.id, v_log.client_id, v_log.workspace_id, v_result, v_log.revision);
    v_status := 'awarded';
  else
    -- A correction or a re-finish never rolls again and never adds a second animal: a workout keeps its animal
    -- forever (only its multiple follows the corrected volume, and may fall under 1). The PRs this log set are
    -- replaced. Only a workout that had no animal and now reaches one gets one, once.
    v_result := jsonb_set(v_existing, '{prs}', coalesce(p_result -> 'award' -> 'prs', '[]'::jsonb));
    v_old_key := v_existing #>> '{ladder,key}';
    v_new_key := p_result #>> '{award,ladder,key}';
    v_multiple := p_result #> '{award,ladder,multiple}';

    if v_old_key is not null then
      -- award-workout always sends the stored animal back; anything else is ignored.
      if v_new_key = v_old_key and jsonb_typeof(v_multiple) = 'number' then
        v_result := jsonb_set(v_result, '{ladder,multiple}', v_multiple);
      end if;
    elsif v_new_key is not null then
      -- Counts and shiny come from the rows, read under the client lock above, so no stale count can be written.
      select * into v_row from public.sticker_awards s
      where s.client_id = v_log.client_id and s.workspace_id = v_log.workspace_id and s.sticker_key = v_new_key
      for update;
      v_is_new := not found;
      if v_is_new then
        -- No roll on a correction, so a new animal is never shiny.
        insert into public.sticker_awards (client_id, workspace_id, sticker_key, shiny, first_log_id)
        values (v_log.client_id, v_log.workspace_id, v_new_key, false, v_log.id)
        returning * into v_row;
      else
        update public.sticker_awards s set count = s.count + 1, last_earned_at = now()
        where s.client_id = v_log.client_id and s.workspace_id = v_log.workspace_id and s.sticker_key = v_new_key
        returning * into v_row;
      end if;
      v_result := jsonb_set(v_result, '{ladder}', jsonb_build_object('key', v_new_key,
        'multiple', coalesce(v_multiple, 'null'::jsonb), 'isNew', v_is_new, 'count', v_row.count,
        'shiny', v_row.shiny));
    end if;

    -- The stored volume follows the correction too (award-workout works it out with the shared logVolumeKg).
    if jsonb_typeof(p_result #> '{award,volumeKg}') = 'number' then
      v_result := jsonb_set(v_result, '{volumeKg}', p_result #> '{award,volumeKg}');
    end if;

    update public.awards a set result = v_result, log_revision = v_log.revision where a.log_id = p_log_id;
    v_status := 'recomputed';
  end if;

  -- The bests: drop the ones no longer held, then upsert the rest through the two partial unique indexes.
  delete from public.personal_records p
  where p.client_id = v_log.client_id and p.workspace_id = v_log.workspace_id
    and not exists (
      select 1 from jsonb_to_recordset(p_result -> 'records') as r(exercise_id uuid, kind text, value_kg numeric)
      where r.exercise_id = p.exercise_id and r.kind = p.kind
        and (p.kind <> 'reps_at_weight' or r.value_kg::numeric(8,3) = p.value_kg));

  insert into public.personal_records as cur
    (client_id, workspace_id, exercise_id, kind, value_kg, reps, log_id, achieved_at)
  select v_log.client_id, v_log.workspace_id, r.exercise_id, r.kind, r.value_kg, r.reps, r.log_id, r.achieved_at
  from jsonb_to_recordset(p_result -> 'records')
    as r(exercise_id uuid, kind text, value_kg numeric, reps integer, log_id uuid, achieved_at timestamptz)
  where r.kind <> 'reps_at_weight'
  on conflict (client_id, workspace_id, exercise_id, kind) where kind <> 'reps_at_weight' do update
    set value_kg = excluded.value_kg, reps = excluded.reps, log_id = excluded.log_id,
        achieved_at = excluded.achieved_at
    where (cur.value_kg, cur.reps, cur.log_id, cur.achieved_at)
      is distinct from (excluded.value_kg, excluded.reps, excluded.log_id, excluded.achieved_at);

  insert into public.personal_records as cur
    (client_id, workspace_id, exercise_id, kind, value_kg, reps, log_id, achieved_at)
  select v_log.client_id, v_log.workspace_id, r.exercise_id, r.kind, r.value_kg, r.reps, r.log_id, r.achieved_at
  from jsonb_to_recordset(p_result -> 'records')
    as r(exercise_id uuid, kind text, value_kg numeric, reps integer, log_id uuid, achieved_at timestamptz)
  where r.kind = 'reps_at_weight'
  on conflict (client_id, workspace_id, exercise_id, value_kg) where kind = 'reps_at_weight' do update
    set reps = excluded.reps, log_id = excluded.log_id, achieved_at = excluded.achieved_at
    where (cur.reps, cur.log_id, cur.achieved_at)
      is distinct from (excluded.reps, excluded.log_id, excluded.achieved_at);

  insert into public.client_stats as cur (client_id, workspace_id, workouts, streak, streak_week, best_streak,
    journey_week, pr_count, lifetime_volume_kg, updated_at)
  values (v_log.client_id, v_log.workspace_id, (v_stats ->> 'workouts')::integer, (v_stats ->> 'streak')::integer,
    (v_stats ->> 'streak_week')::date, (v_stats ->> 'best_streak')::integer, (v_stats ->> 'journey_week')::integer,
    (v_stats ->> 'pr_count')::integer, (v_stats ->> 'lifetime_volume_kg')::numeric, now())
  on conflict (client_id, workspace_id) do update
    set workouts = excluded.workouts, streak = excluded.streak, streak_week = excluded.streak_week,
        best_streak = excluded.best_streak, journey_week = excluded.journey_week, pr_count = excluded.pr_count,
        lifetime_volume_kg = excluded.lifetime_volume_kg, updated_at = now();

  return jsonb_build_object('status', v_status, 'result', v_result);
end;
$$;

revoke execute on function public.apply_award(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_award(uuid, jsonb) to service_role;

create or replace function public.build_community_card(p_workspace_id uuid, p_author_id uuid, p_card jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text;
  v_log public.workout_logs%rowtype;
  v_award jsonb;
  v_sticker public.sticker_awards%rowtype;
  v_prs jsonb;
begin
  if jsonb_typeof(p_card) is distinct from 'object' then
    raise exception 'Card must be an object' using errcode = '22023';
  end if;
  v_kind := p_card ->> 'kind';
  if v_kind = 'sticker' then
    if exists (select 1 from jsonb_object_keys(p_card) k where k not in ('kind', 'stickerKey'))
      or jsonb_typeof(p_card -> 'stickerKey') is distinct from 'string' then
      raise exception 'A sticker card names only the sticker' using errcode = '22023';
    end if;
    select * into v_sticker from public.sticker_awards a
    where a.client_id = p_author_id and a.workspace_id = p_workspace_id and a.sticker_key = p_card ->> 'stickerKey';
    if not found then
      raise exception 'You can only share stickers you have' using errcode = '42501';
    end if;
    return jsonb_build_object('kind', 'sticker', 'stickerKey', v_sticker.sticker_key, 'shiny', v_sticker.shiny,
      'count', v_sticker.count);
  end if;

  if v_kind not in ('workout', 'pr') or v_kind is null then
    raise exception 'Unknown card' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_card) k where k not in ('kind', 'logId'))
    or coalesce(p_card ->> 'logId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'A workout card names only the workout' using errcode = '22023';
  end if;
  select * into v_log from public.workout_logs l
  where l.id = (p_card ->> 'logId')::uuid and l.client_id = p_author_id and l.workspace_id = p_workspace_id
    and l.status = 'completed';
  if not found then
    raise exception 'You can only share your own finished workouts' using errcode = '42501';
  end if;
  select a.result into v_award from public.awards a where a.log_id = v_log.id and a.client_id = p_author_id;

  if v_kind = 'workout' then
    return jsonb_build_object(
      'kind', 'workout',
      'logId', v_log.id,
      'workoutName', left(v_log.name, 120),
      'finishedAt', v_log.finished_at,
      'exerciseCount', (select count(*) from public.log_exercises e join public.log_blocks b on b.id = e.block_id
        where b.log_id = v_log.id),
      'setCount', (select count(*) from public.log_sets st join public.log_exercises e on e.id = st.log_exercise_id
        join public.log_blocks b on b.id = e.block_id where b.log_id = v_log.id and st.completed_at is not null),
      'stickerKey', v_award #>> '{ladder,key}',
      'multiple', v_award #> '{ladder,multiple}',
      'shiny', coalesce((v_award #>> '{ladder,shiny}')::boolean, false),
      -- Copied from the stored award (award-workout worked it out); null for an award stored before volumes were.
      'volumeKg', case when jsonb_typeof(v_award -> 'volumeKg') = 'number' then
        case when (v_award ->> 'volumeKg')::numeric >= 0 then v_award -> 'volumeKg' end end);
  end if;

  select jsonb_agg(jsonb_build_object(
      'exerciseName', coalesce(left(x.name, 120), 'Exercise'),
      'prKind', pr ->> 'kind',
      'valueKg', pr -> 'valueKg',
      'reps', pr -> 'reps') order by ord)
    into v_prs
  from jsonb_array_elements(coalesce(v_award -> 'prs', '[]'::jsonb)) with ordinality as t(pr, ord)
  left join public.exercises x on x.id = case
    when pr ->> 'exerciseId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (pr ->> 'exerciseId')::uuid
  end
  where ord <= 5;
  if v_prs is null then
    raise exception 'This workout set no personal bests' using errcode = '22023';
  end if;
  return jsonb_build_object('kind', 'pr', 'logId', v_log.id, 'workoutName', left(v_log.name, 120),
    'finishedAt', v_log.finished_at, 'prs', v_prs);
end;
$$;

revoke execute on function public.build_community_card(uuid, uuid, jsonb) from public, anon, authenticated;

create function public.preview_community_card(p_community_id uuid, p_card jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_ws uuid;
begin
  if v_me is null or p_card is null or not public.can_view_community(p_community_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select c.workspace_id into v_ws from public.communities c where c.id = p_community_id;
  return public.build_community_card(v_ws, v_me, p_card);
end;
$$;

revoke execute on function public.preview_community_card(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.preview_community_card(uuid, jsonb) to authenticated;
