-- Running an assessment: a screen that was open on old data must never save over newer marks (QA, 2026-11-21: Back
-- from Findings brought back a cached test 1 with every line Normal, and "Next test" saved those Normals over the
-- coach's Severe marks).
--
-- Each test gets a revision number, bumped by every save. The run screen sends the revision it loaded; when the test
-- was saved since (another tab, or a stale cached screen), save_assessment_test refuses with PT409 (HTTP 409; not
-- 40001, which the client library retries) and the screen asks the coach to reload. p_expected_revision is optional so a web deploy still running the old server code keeps
-- working while the new one rolls out; the new web app always sends it. Returns the new revision.

alter table public.assessment_tests add column revision integer not null default 0 check (revision >= 0);
-- Written only by save_assessment_test (the write guard refuses direct updates, as for the other columns).
grant update (revision) on public.assessment_tests to authenticated;

drop function public.save_assessment_test(uuid, text, jsonb, jsonb, jsonb, boolean, boolean, text, text, smallint);

create function public.save_assessment_test(
  p_test_id uuid,
  p_status text,
  p_results jsonb,
  p_measures jsonb,
  p_follow_ups jsonb,
  p_discomfort_left boolean,
  p_discomfort_right boolean,
  p_type_done text,
  p_note text,
  p_score smallint,
  p_expected_revision integer default null
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_ws uuid;
  v_def jsonb;
  v_revision integer;
begin
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_typeof(p_measures) is distinct from 'array'
    or jsonb_array_length(p_results) > 200 or jsonb_array_length(p_measures) > 50 then
    raise exception 'The results are not valid.' using errcode = '22023';
  end if;
  perform set_config('caltracker.assessment_write', 'on', true);

  update public.assessment_tests
    set status = p_status, follow_ups = coalesce(p_follow_ups, '{}'::jsonb), discomfort_left = p_discomfort_left,
      discomfort_right = p_discomfort_right, type_done = coalesce(p_type_done, ''), note = coalesce(p_note, ''),
      score = p_score, revision = revision + 1
    where id = p_test_id and (p_expected_revision is null or revision = p_expected_revision)
    returning workspace_id, definition, revision into v_ws, v_def, v_revision;
  if v_ws is null then
    if p_expected_revision is not null
      and exists (select 1 from public.assessment_tests t where t.id = p_test_id and t.revision <> p_expected_revision) then
      raise exception 'This assessment changed since it was opened.' using errcode = 'PT409';
    end if;
    raise exception 'This assessment can''t be changed.' using errcode = '42501';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_results) as r(checkpoint_id text, side text, severity text)
    where not exists (
      select 1 from jsonb_path_query(v_def, '$.views[*].groups[*].checkpoints[*]') as c(cp)
      where c.cp ->> 'id' = r.checkpoint_id
        and (case when (c.cp ->> 'sided')::boolean then r.side in ('L', 'R') else r.side = 'none' end))
  ) then
    raise exception 'A rating does not fit this test.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_measures) as r(measure_id text, side text, value numeric)
    where not exists (
      select 1 from jsonb_path_query(v_def, '$.measures[*]') as m(ms)
      where m.ms ->> 'id' = r.measure_id
        and (case when (m.ms ->> 'sided')::boolean then r.side in ('L', 'R') else r.side = 'none' end)
        and r.value between (m.ms ->> 'min')::numeric and (m.ms ->> 'max')::numeric)
  ) then
    raise exception 'A number does not fit this test.' using errcode = '22023';
  end if;

  delete from public.assessment_checkpoint_results where test_id = p_test_id;
  insert into public.assessment_checkpoint_results (test_id, workspace_id, checkpoint_id, side, severity)
    select p_test_id, v_ws, r.checkpoint_id, r.side, r.severity
    from jsonb_to_recordset(p_results) as r(checkpoint_id text, side text, severity text);

  delete from public.assessment_measure_results where test_id = p_test_id;
  insert into public.assessment_measure_results (test_id, workspace_id, measure_id, side, value, unit, higher_is_better)
    select p_test_id, v_ws, r.measure_id, r.side, r.value, m.ms ->> 'unit', (m.ms ->> 'higherIsBetter')::boolean
    from jsonb_to_recordset(p_measures) as r(measure_id text, side text, value numeric)
    join lateral (select x.ms from jsonb_path_query(v_def, '$.measures[*]') as x(ms) where x.ms ->> 'id' = r.measure_id) m on true;
  perform set_config('caltracker.assessment_write', 'off', true);
  return v_revision;
end;
$$;
revoke execute on function public.save_assessment_test(uuid, text, jsonb, jsonb, jsonb, boolean, boolean, text, text, smallint, integer) from public, anon;
grant execute on function public.save_assessment_test(uuid, text, jsonb, jsonb, jsonb, boolean, boolean, text, text, smallint, integer) to authenticated;
