begin;
select plan(79);

-- Admin "Add coach" and "Delete coach" (migration 20261110004000_admin_coach.sql). The admin-coach Edge Function
-- checks owner + aal2 with admin_require_owner (the caller's JWT), then calls the service-role functions with the
-- admin's id. This file proves the database half: who may call what, that creating makes the workspace and the owner
-- membership, and that deleting removes every row of the workspace in every table while client accounts, their rows
-- in other workspaces and the audit log stay.

-- ---------- Catalog guards: a new table or bucket must be thought about before it ships ----------

-- Every table with a workspace_id column. Deleting a workspace must remove its rows from each one (checked below for
-- all of them, by name). A new table fails here: make sure its workspace_id cascades from workspaces (or its parent
-- row does), add it to this list, and seed it below if you can.
select is(
  (select array_agg(c.table_name::text order by c.table_name::text collate "C")
   from information_schema.columns c
   join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
   where c.table_schema = 'public' and c.column_name = 'workspace_id'),
  array[
    'awards', 'body_measurements', 'client_documents', 'client_goals', 'client_invite_plan_items', 'client_invites',
    'client_limitations', 'client_notes', 'client_stats', 'coach_meals', 'communities', 'community_blocks',
    'community_comments', 'community_members', 'community_notifications', 'community_post_images', 'community_posts',
    'community_reactions', 'community_reports', 'conversations', 'custom_metrics', 'exercise_overrides', 'exercises',
    'live_sync_tombstones', 'log_blocks', 'log_exercises', 'log_sets', 'meals', 'messages', 'nutrition_targets',
    'past_clients', 'personal_records', 'program_assignments', 'program_workouts', 'programs', 'push_outbox',
    'sticker_awards', 'workout_blocks', 'workout_exercises', 'workout_log_comments', 'workout_logs', 'workout_sets',
    'workout_substitutes', 'workouts', 'workspace_members'
  ]::text[] collate "C",
  'every table with a workspace_id is on the reviewed list (a new one must be added here)');

-- Every foreign key to workspaces cascades, so deleting the workspace takes the rows with it.
select is(
  (select array_agg(format('%s:%s', c.conrelid::regclass, c.confdeltype) order by c.conrelid::regclass::text)
   from pg_constraint c
   where c.contype = 'f' and c.confrelid = 'public.workspaces'::regclass and c.confdeltype <> 'c'),
  null, 'every foreign key to workspaces is on delete cascade');

-- A workspace_id column without a foreign key to workspaces must hang off a parent row that has one (children of
-- workouts, logs and programs copy the id for RLS). Reviewed list.
select is(
  (select array_agg(c.table_name::text order by c.table_name::text collate "C")
   from information_schema.columns c
   join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
   where c.table_schema = 'public' and c.column_name = 'workspace_id'
     and not exists (
       select 1 from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
       where k.contype = 'f' and k.conrelid = to_regclass('public.' || quote_ident(c.table_name))
         and a.attname = 'workspace_id' and k.confrelid = 'public.workspaces'::regclass)),
  array['community_members', 'community_post_images', 'community_posts', 'log_blocks', 'log_exercises', 'log_sets',
        'program_workouts', 'workout_blocks', 'workout_exercises', 'workout_log_comments', 'workout_sets',
        'workout_substitutes']::text[] collate "C",
  'workspace_id columns without their own key to workspaces are on the reviewed list');

-- Every bucket is either listed by admin_coach_delete_files by workspace folder, or holds no workspace files.
select is((select array_agg(id::text order by id::text collate "C") from storage.buckets),
  array['avatars', 'client-documents', 'coach-meal-photos', 'community-images', 'exercise-images', 'meal-photos',
        'message-images', 'scan-attachments']::text[],
  'the bucket list is the reviewed one (a new bucket with workspace folders must be added to admin_coach_delete_files)');

-- ---------- Structure and grants ----------
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.closed_workspace_clients'::regclass),
  'closed_workspace_clients has RLS');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'closed_workspace_clients'),
  0, 'closed_workspace_clients has no policies (functions only)');
select table_privs_are('public', 'closed_workspace_clients', 'authenticated', array[]::text[],
  'authenticated has no privileges on closed_workspace_clients');
select table_privs_are('public', 'closed_workspace_clients', 'anon', array[]::text[],
  'anon has no privileges on closed_workspace_clients');

select ok(
  bool_and(has_function_privilege('service_role', f, 'execute'))
    and not bool_or(has_function_privilege('authenticated', f, 'execute'))
    and not bool_or(has_function_privilege('anon', f, 'execute')),
  'the privileged coach functions are for the service role only')
from unnest(array['public.admin_coach_email_status(uuid, text)', 'public.admin_create_coach(uuid, uuid, text)',
  'public.admin_coach_delete_files(uuid, uuid[])', 'public.admin_delete_coach(uuid, uuid, text)']) f;
select ok(
  bool_and(has_function_privilege('authenticated', f, 'execute'))
    and not bool_or(has_function_privilege('anon', f, 'execute')),
  'the owner check and the delete preview are for signed-in callers (they check the role themselves)')
from unnest(array['public.admin_require_owner()', 'public.admin_coach_delete_preview(uuid)']) f;

-- ---------- People ----------
select tests.create_user('ac-owner@t.local', 'Olive Owner') as owner \gset
select tests.create_user('ac-support@t.local', 'Sue Support') as support \gset
select tests.create_user('ac-ro@t.local', 'Rob Readonly') as ro \gset
insert into public.admin_users (user_id, role) values (:'owner', 'owner'), (:'support', 'support'), (:'ro', 'readonly');

select tests.create_user('ac-coach@t.local', 'Luis Bueno') as coach \gset
select tests.create_workspace('Luis Bueno Coaching', :'coach') as ws \gset
select tests.create_user('ac-stan@t.local', 'Stan Staff') as stan \gset
select tests.create_user('ac-olga@t.local', 'Olga Other') as olga \gset
insert into public.workspace_members (workspace_id, user_id, role) values (:'ws', :'stan', 'staff'), (:'ws', :'olga', 'staff');
select tests.create_user('ac-coach2@t.local', 'Maya Patel') as coach2 \gset
select tests.create_workspace('Maya Coaching', :'coach2') as ws2 \gset
-- Olga also coaches in Maya's workspace, so her account stays.
insert into public.workspace_members (workspace_id, user_id, role) values (:'ws2', :'olga', 'staff');
select tests.create_user('ac-vic@t.local', 'Vic Client') as vic \gset
select tests.create_user('ac-kay@t.local', 'Kay Client') as kay \gset
select tests.create_user('ac-zed@t.local', 'Zed Other') as zed \gset
select tests.add_client(:'ws', :'vic');
select tests.add_client(:'ws', :'kay');
select tests.add_client(:'ws2', :'zed');

-- ---------- Owner only ----------
select tests.act_as_aal(:'owner', 'aal2');
select ok(public.admin_require_owner(), 'an owner at aal2 passes the owner check');
select tests.act_as_aal(:'owner', 'aal1');
select throws_ok('select public.admin_require_owner()', '42501', null, 'an owner at aal1 (no two-step) is refused');
select tests.act_as_aal(:'support', 'aal2');
select throws_ok('select public.admin_require_owner()', '42501', null, 'support is refused');
select throws_ok(format('select public.admin_coach_delete_preview(%L)', :'ws'), '42501', null,
  'support cannot open the delete preview');
select tests.act_as_aal(:'ro', 'aal2');
select throws_ok('select public.admin_require_owner()', '42501', null, 'readonly is refused');
select tests.act_as_aal(:'coach', 'aal2');
select throws_ok('select public.admin_require_owner()', '42501', null, 'a non-admin is refused');
select throws_ok(format('select public.admin_create_coach(%L, %L, %L)', :'owner', :'coach', 'X'), '42501', null,
  'a signed-in user cannot call the service-role create function at all');
select throws_ok(format('select public.admin_delete_coach(%L, %L, %L)', :'owner', :'ws', 'Luis Bueno Coaching'), '42501',
  null, 'a signed-in user cannot call the service-role delete function at all');
reset role;
select set_config('request.jwt.claims', '', true);

-- The service-role functions check the admin id they are given.
set local role service_role;
select throws_ok(format('select public.admin_coach_email_status(%L, %L)', :'support', 'x@t.local'), '42501', null,
  'service role: a support admin id is refused (email check)');
select throws_ok(format('select public.admin_create_coach(%L, %L, %L)', :'ro', :'coach', 'X'), '42501', null,
  'service role: a readonly admin id is refused (create)');
select throws_ok(format('select public.admin_delete_coach(%L, %L, %L)', :'support', :'ws', 'Luis Bueno Coaching'), '42501',
  null, 'service role: a support admin id is refused (delete)');
select throws_ok(format('select public.admin_delete_coach(%L, %L, %L)', :'coach', :'ws', 'Luis Bueno Coaching'), '42501',
  null, 'service role: a non-admin id is refused (delete)');
select throws_ok(format('select public.admin_delete_coach(null, %L, %L)', :'ws', 'Luis Bueno Coaching'), '42501',
  null, 'service role: no admin id is refused');

-- ---------- Add coach ----------
select is(public.admin_coach_email_status(:'owner', ' NEW-coach@t.local '), 'new', 'a new email is new');
select is(public.admin_coach_email_status(:'owner', 'AC-coach@t.local'), 'coach', 'an owner''s email is a coach (any case)');
select is(public.admin_coach_email_status(:'owner', 'ac-stan@t.local'), 'coach', 'a staff member''s email is a coach');
select is(public.admin_coach_email_status(:'owner', 'ac-support@t.local'), 'admin', 'an admin''s email is an admin');
select is(public.admin_coach_email_status(:'owner', 'ac-vic@t.local'), 'client', 'a client''s email is a client');
reset role;
select set_config('request.jwt.claims', '', true);

-- As after Supabase Auth's invite: the account exists with its name, no membership yet.
select tests.create_user('ac-sam@t.local', 'Sam Rivera', false) as sam \gset
select tests.create_exercise(null, 'AC Global squat') as global_ex \gset
set local role service_role;
select public.admin_create_coach(:'owner', :'sam', '  Sam Fit Coaching ') as sam_ws \gset
reset role;
select set_config('request.jwt.claims', '', true);
select is((select name from public.workspaces where id = :'sam_ws'), 'Sam Fit Coaching', 'the workspace is created, trimmed');
select results_eq(format('select user_id, role::text from public.workspace_members where workspace_id = %L', :'sam_ws'),
  format('values (%L::uuid, %L::text)', :'sam', 'owner'), 'the coach is its only member, as owner');
select is((select count(*)::int from public.community_members cm join public.communities c on c.id = cm.community_id
           where c.workspace_id = :'sam_ws' and cm.user_id = :'sam'), 1, 'the workspace has a community and the coach is in it');
select results_eq(
  format($$select action, target_user_id, details ->> 'workspace_name', details ->> 'email', (details ->> 'workspace_id')::uuid
    from public.admin_audit_log where admin_id = %L and action = 'add_coach'$$, :'owner'),
  format($$values ('add_coach'::text, %L::uuid, 'Sam Fit Coaching'::text, 'ac-sam@t.local'::text, %L::uuid)$$, :'sam', :'sam_ws'),
  'one add_coach audit row, by the owner, about the coach');
select tests.act_as(:'sam');
select is((select count(*)::int from public.exercises where id = :'global_ex'), 1,
  'the new coach sees the standard (global) exercise library');
reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;
select throws_ok(format('select public.admin_create_coach(%L, %L, %L)', :'owner', :'sam', 'Again'), '23505', null,
  'an account that already belongs to a workspace is refused');
select throws_ok(format('select public.admin_create_coach(%L, %L, %L)', :'owner', :'support', 'Admin Gym'), '23505', null,
  'an admin''s account is refused');
select throws_ok(format('select public.admin_create_coach(%L, %L, %L)', :'owner', :'zed', ' '), '22023', null,
  'a blank workspace name is refused');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------- Seed the workspace to delete (and Maya's, which must not change) ----------
select id as comm from public.communities where workspace_id = :'ws' \gset
select id as comm2 from public.communities where workspace_id = :'ws2' \gset

-- Kay trained with Maya before: a past-client record and an old log in Maya's workspace.
insert into public.past_clients (workspace_id, user_id, email, first_name, last_name, removed_by)
values (:'ws2', :'kay', 'ac-kay@t.local', 'Kay', 'Client', :'coach2');
select tests.create_log(:'ws2', :'kay') as kay_old_log \gset

-- Invites: Vic's accepted one with a plan item, and a pending one.
select tests.create_invite(:'ws', 'ac-vic@t.local', 'Vic Client', :'coach', 'ac-vic-token') as inv \gset
update public.client_invites set accepted_at = now(), accepted_by = :'vic' where id = :'inv';
select tests.create_invite(:'ws', 'ac-new@t.local', 'New Person', :'stan', 'ac-new-token') as inv_pending \gset

-- Library: program with a day, library workout, custom exercise, favourite, override, coach meal, custom metric.
insert into public.programs (workspace_id, name, created_by) values (:'ws', 'AC Strength', :'coach') returning id as prog \gset
select tests.create_exercise(:'ws', 'AC Coach press') as coach_ex \gset
select tests.create_workout(:'ws', 'AC Library day', null, null, :'coach_ex') as lib_workout \gset
insert into public.program_workouts (program_id, week, day, position, workout_id) values (:'prog', 1, 1, 0, :'lib_workout');
insert into public.exercise_favorites (coach_id, exercise_id) values (:'olga', :'coach_ex');
insert into public.exercise_overrides (workspace_id, exercise_id, coach_notes) values (:'ws', :'global_ex', 'Knees out');
insert into public.coach_meals (workspace_id, name, calories, created_by)
values (:'ws', 'AC Oats', 400, :'coach') returning id as coach_meal \gset
insert into public.custom_metrics (workspace_id, name, min, max) values (:'ws', 'Waist', 15, 80);
insert into public.client_invite_plan_items (invite_id, workspace_id, program_id, start_on)
values (:'inv_pending', :'ws', :'prog', current_date);

-- Vic's training: assignment, assigned workout (with the custom exercise), finished log, comment, awards, stats.
insert into public.program_assignments (workspace_id, client_id, program_id, program_name, weeks, start_date, created_by)
values (:'ws', :'vic', :'prog', 'AC Strength', 4, current_date, :'coach');
select tests.create_workout(:'ws', 'AC Vic day', :'vic', current_date, :'coach_ex') as vic_workout \gset
select tests.create_log(:'ws', :'vic', :'vic_workout') as vic_log \gset
insert into public.workout_log_comments (log_id, workspace_id, client_id, author_id, body)
values (:'vic_log', :'ws', :'vic', :'coach', 'Great work');
insert into public.awards (log_id, client_id, workspace_id, result) values (:'vic_log', :'vic', :'ws', '{}');
insert into public.sticker_awards (client_id, workspace_id, sticker_key, first_log_id) values (:'vic', :'ws', 'cat', :'vic_log');
insert into public.client_stats (client_id, workspace_id, workouts) values (:'vic', :'ws', 1);
insert into public.personal_records (client_id, workspace_id, exercise_id, kind, value_kg, achieved_at, log_id)
values (:'vic', :'ws', :'coach_ex', 'heaviest', 60, now(), :'vic_log');

-- Messages, body scans, documents, goals, limitations, notes, food, push.
insert into public.conversations (workspace_id, client_id) values (:'ws', :'vic') returning id as conv \gset
insert into public.messages (conversation_id, workspace_id, sender_id, body) values (:'conv', :'ws', :'coach', 'Hi Vic'),
  (:'conv', :'ws', :'vic', 'Hi coach');
insert into public.conversation_reads (conversation_id, user_id) values (:'conv', :'vic');
insert into public.body_measurements (workspace_id, client_id, measured_on, entered_by, source)
values (:'ws', :'vic', current_date, :'coach', 'coach') returning id as scan \gset
insert into public.body_measurement_values (measurement_id, metric_key, value) values (:'scan', 'weight_kg', 80);
select gen_random_uuid() as doc_file \gset
insert into public.client_documents (workspace_id, client_id, name, storage_path, content_type, size_bytes, uploaded_by)
values (:'ws', :'vic', 'InBody', :'ws' || '/' || :'vic' || '/' || :'doc_file' || '.pdf', 'application/pdf', 100, :'coach');
insert into public.client_goals (workspace_id, client_id, goal) values (:'ws', :'vic', 'Run 5k');
insert into public.client_limitations (workspace_id, client_id, body) values (:'ws', :'vic', 'Knee');
insert into public.client_notes (workspace_id, client_id, body, created_by) values (:'ws', :'vic', 'Note', :'coach');
insert into public.meals (workspace_id, client_id, eaten_on, name, calories, coach_meal_id)
values (:'ws', :'vic', current_date, 'AC Oats', 400, :'coach_meal');
insert into public.nutrition_targets (workspace_id, client_id, calories, updated_by) values (:'ws', :'vic', 2000, :'coach');
insert into public.push_outbox (user_id, workspace_id, type, group_key) values (:'vic', :'ws', 'message', 'ac-vic');

-- Community: posts, a photo, comment, reaction, block, report, notification.
insert into public.community_posts (community_id, workspace_id, author_id, body, image_count)
values (:'comm', :'ws', :'vic', 'Vic post', 1) returning id as vic_post \gset
insert into public.community_post_images (post_id, workspace_id, position, path, thumb_path, width, height)
values (:'vic_post', :'ws', 0, :'ws' || '/' || :'vic' || '/' || :'vic_post' || '/a.webp',
  :'ws' || '/' || :'vic' || '/' || :'vic_post' || '/a-thumb.webp', 100, 100);
insert into public.community_comments (post_id, community_id, workspace_id, author_id, body)
values (:'vic_post', :'comm', :'ws', :'kay', 'Nice');
insert into public.community_reactions (post_id, community_id, workspace_id, user_id, reaction)
values (:'vic_post', :'comm', :'ws', :'kay', 'fire');
insert into public.community_blocks (workspace_id, blocker_id, blocked_id) values (:'ws', :'kay', :'vic');
insert into public.community_reports (workspace_id, community_id, reporter_id, target_kind, post_id, target_author_id,
  target_body, reason)
values (:'ws', :'comm', :'kay', 'post', :'vic_post', :'vic', 'Vic post', 'spam');
insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, actor_id)
values (:'ws', :'comm', :'vic', 'comment', :'vic_post', :'kay');

-- Maya's workspace has its own things: Zed's log, a message, a post.
select tests.create_log(:'ws2', :'zed') as zed_log \gset
insert into public.conversations (workspace_id, client_id) values (:'ws2', :'zed') returning id as conv2 \gset
insert into public.messages (conversation_id, workspace_id, sender_id, body) values (:'conv2', :'ws2', :'coach2', 'Hi Zed');
insert into public.community_posts (community_id, workspace_id, author_id, body) values (:'comm2', :'ws2', :'zed', 'Zed post');

-- Files: the workspace's folders, the deleted coaches' avatars, and others' files that stay.
insert into storage.objects (bucket_id, name, owner_id) values
  ('client-documents', :'ws' || '/' || :'vic' || '/' || :'doc_file' || '.pdf', :'coach'),
  ('scan-attachments', :'ws' || '/' || :'vic' || '/scan.pdf', :'coach'),
  ('meal-photos', :'ws' || '/' || :'vic' || '/m-1.webp', :'vic'),
  ('message-images', :'ws' || '/' || :'conv' || '/coach.webp', :'coach'),
  ('community-images', :'ws' || '/' || :'vic' || '/' || :'vic_post' || '/a.webp', :'vic'),
  ('coach-meal-photos', :'ws' || '/' || :'coach_meal' || '-p.webp', :'coach'),
  ('avatars', :'coach' || '/avatar.webp', :'coach'),
  ('avatars', :'stan' || '/avatar.webp', :'stan'),
  ('avatars', :'olga' || '/avatar.webp', :'olga'),
  ('avatars', :'vic' || '/avatar.webp', :'vic'),
  ('meal-photos', :'ws2' || '/' || :'zed' || '/m-2.webp', :'zed'),
  ('message-images', :'ws2' || '/' || :'conv2' || '/coach.webp', :'coach2');

-- Rows per workspace table, by workspace (works for every table on the reviewed list).
create function pg_temp.ws_rows(p_ws uuid) returns table (tbl text, n bigint)
language plpgsql as $$
declare
  r record;
begin
  for r in
    select c.table_name::text as t from information_schema.columns c
    join pg_tables pt on pt.schemaname = 'public' and pt.tablename = c.table_name
    where c.table_schema = 'public' and c.column_name = 'workspace_id'
  loop
    tbl := r.t;
    execute format('select count(*) from public.%I where workspace_id = $1', r.t) into n using p_ws;
    return next;
  end loop;
end;
$$;
create temp table ws_before as select * from pg_temp.ws_rows(:'ws');
create temp table ws2_before as select * from pg_temp.ws_rows(:'ws2');
select ok((select count(*) from ws_before where n > 0) >= 35,
  'the seed fills most workspace tables (' || (select count(*) from ws_before where n > 0) || ')');

create temp table audit_before as select count(*) as n from public.admin_audit_log;

-- ---------- The delete preview (the dialog) ----------
select tests.act_as_aal(:'owner', 'aal2');
select public.admin_coach_delete_preview(:'ws') as preview \gset
reset role;
select set_config('request.jwt.claims', '', true);
select is((:'preview'::jsonb) -> 'counts',
  jsonb_build_object('clients', 2, 'staff', 2, 'programs', 1, 'workouts', 1, 'shared_meals', 1, 'custom_exercises', 1,
    'logs', 1, 'messages', 2, 'posts', 1),
  'the preview counts clients, programs, library workouts, shared meals and more');
select is((:'preview'::jsonb) ->> 'coach_name', 'Luis Bueno', 'the preview names the coach');
select is((:'preview'::jsonb) -> 'delete_account_ids', jsonb_build_array(:'coach', :'stan'),
  'the coach and Stan (no other workspace) lose their accounts; Olga (also Maya''s staff) keeps hers');
select is((:'preview'::jsonb) ->> 'blocker', '', 'nothing blocks this delete');

set local role service_role;
select set_eq(
  format('select bucket_id, name from public.admin_coach_delete_files(%L, array[%L, %L]::uuid[])', :'ws', :'coach', :'stan'),
  format($$values ('avatars'::text, %L::text), ('avatars', %L), ('client-documents', %L), ('coach-meal-photos', %L),
    ('community-images', %L), ('meal-photos', %L), ('message-images', %L), ('scan-attachments', %L)$$,
    :'coach' || '/avatar.webp', :'stan' || '/avatar.webp', :'ws' || '/' || :'vic' || '/' || :'doc_file' || '.pdf',
    :'ws' || '/' || :'coach_meal' || '-p.webp', :'ws' || '/' || :'vic' || '/' || :'vic_post' || '/a.webp',
    :'ws' || '/' || :'vic' || '/m-1.webp', :'ws' || '/' || :'conv' || '/coach.webp', :'ws' || '/' || :'vic' || '/scan.pdf'),
  'the files: every workspace folder and the deleted coaches'' files; not Olga''s, the clients'' avatars or Maya''s');

-- ---------- Refusals ----------
select throws_ok(format('select public.admin_delete_coach(%L, %L, %L)', :'owner', :'ws', 'luis bueno coaching'), '22023',
  'admin: type the workspace name exactly to confirm', 'the typed name must match exactly (case too)');
select throws_ok(format('select public.admin_delete_coach(%L, %L, %L)', :'owner', gen_random_uuid(), 'X'), 'P0002', null,
  'an unknown workspace is refused');
reset role;
select set_config('request.jwt.claims', '', true);
-- The owner is a member of Sam's workspace for a moment: refused.
insert into public.workspace_members (workspace_id, user_id, role) values (:'sam_ws', :'owner', 'staff');
set local role service_role;
select throws_ok(format('select public.admin_delete_coach(%L, %L, %L)', :'owner', :'sam_ws', 'Sam Fit Coaching'), '55000',
  'admin: You can''t delete a workspace you belong to.', 'an admin cannot delete a workspace they belong to');
reset role;
select set_config('request.jwt.claims', '', true);
delete from public.workspace_members where workspace_id = :'sam_ws' and user_id = :'owner';
-- Sam becomes support staff: refused, because deleting the workspace would delete an admin's account.
insert into public.admin_users (user_id, role) values (:'sam', 'support');
select tests.act_as_aal(:'owner', 'aal2');
select is(public.admin_coach_delete_preview(:'sam_ws') ->> 'blocker',
  'A coach in this workspace is a CalTracker admin. Remove them on the Admins page first.', 'the preview says why');
reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;
select throws_ok(format('select public.admin_delete_coach(%L, %L, %L)', :'owner', :'sam_ws', 'Sam Fit Coaching'), '55000',
  null, 'a workspace whose coach is an admin is refused');
reset role;
select set_config('request.jwt.claims', '', true);
delete from public.admin_users where user_id = :'sam';
select is((select count(*)::int from public.workspaces where id in (:'ws', :'sam_ws')), 2, 'refusals change nothing');
select is((select count(*) from public.admin_audit_log), (select n from audit_before), 'refusals write no audit row');

-- ---------- The delete ----------
set local role service_role;
select public.admin_delete_coach(:'owner', :'ws', 'Luis Bueno Coaching') as result \gset
reset role;
select set_config('request.jwt.claims', '', true);

select is((:'result'::jsonb) -> 'delete_account_ids', jsonb_build_array(:'coach', :'stan'),
  'it returns the accounts for the Edge Function to delete');
select is((:'result'::jsonb) -> 'clients',
  jsonb_build_array(jsonb_build_object('user_id', :'kay', 'email', 'ac-kay@t.local', 'first_name', 'Kay'),
                    jsonb_build_object('user_id', :'vic', 'email', 'ac-vic@t.local', 'first_name', 'Vic')),
  'it returns the clients to email');
select is((:'result'::jsonb) ->> 'coach_name', 'Luis Bueno', 'it returns the coach''s name for the email');

select is((select count(*)::int from public.workspaces where id = :'ws'), 0, 'the workspace is gone');
select is((select string_agg(tbl || '=' || n, ', ' order by tbl) from pg_temp.ws_rows(:'ws') where n > 0), null,
  'no row of the workspace is left in any table with a workspace_id');
select is((select count(*)::int from public.workspace_members m where not exists (
  select 1 from public.workspaces w where w.id = m.workspace_id)), 0, 'no orphaned memberships anywhere');
select is((select count(*)::int from public.log_sets s where not exists (
  select 1 from public.log_exercises e where e.id = s.log_exercise_id)), 0, 'no orphaned log sets');
select is((select count(*)::int from public.body_measurement_values where measurement_id = :'scan'), 0,
  'body scan values are gone');
select is((select count(*)::int from public.conversation_reads where conversation_id = :'conv'), 0, 'read markers are gone');
select is((select count(*)::int from public.exercise_favorites where exercise_id = :'coach_ex'), 0,
  'favourites of the deleted custom exercise are gone');
select is((select count(*)::int from public.client_invites where id in (:'inv', :'inv_pending')), 0,
  'the workspace''s invites are gone');

-- Clients keep their accounts and their rows elsewhere.
select is((select count(*)::int from auth.users where id in (:'vic', :'kay')), 2, 'both clients keep their accounts');
select is((select count(*)::int from public.profiles where id in (:'vic', :'kay')), 2, 'both clients keep their profiles');
select is((select count(*)::int from public.workspace_members where user_id in (:'vic', :'kay')), 0,
  'the clients have no membership left');
select is((select count(*)::int from public.workout_logs where id = :'kay_old_log'), 1,
  'Kay keeps her log in Maya''s workspace');
select is((select count(*)::int from public.past_clients where workspace_id = :'ws2' and user_id = :'kay'), 1,
  'Kay keeps her past-client record with Maya');
select results_eq(
  'select user_id, email, first_name, last_name, workspace_name from public.closed_workspace_clients order by email',
  format($$values (%L::uuid, 'ac-kay@t.local'::text, 'Kay'::text, 'Client'::text, 'Luis Bueno Coaching'::text),
                  (%L::uuid, 'ac-vic@t.local', 'Vic', 'Client', 'Luis Bueno Coaching')$$, :'kay', :'vic'),
  'both clients are recorded as clients of a closed workspace');

-- The coaches: still there until the Edge Function deletes them; Olga keeps Maya's membership.
select is((select count(*)::int from public.workspace_members where user_id = :'olga'), 1,
  'Olga keeps her membership in Maya''s workspace');

-- Maya's workspace is untouched.
select is(
  (select string_agg(a.tbl || ':' || b.n || '->' || a.n, ', ' order by a.tbl)
   from pg_temp.ws_rows(:'ws2') a join ws2_before b on b.tbl = a.tbl where a.n <> b.n),
  null, 'every table has the same rows for Maya''s workspace as before');

-- The audit log: one delete_coach row, everything before it kept.
select is((select count(*) from public.admin_audit_log), (select n from audit_before) + 1,
  'the audit log keeps every row and gains one');
select results_eq(
  format($$select admin_id, target_user_id, details ->> 'workspace_name', details -> 'counts' -> 'clients',
    details -> 'counts' -> 'programs', details -> 'counts' -> 'workouts', details -> 'counts' -> 'shared_meals',
    details -> 'deleted_account_ids'
    from public.admin_audit_log where action = 'delete_coach'$$),
  format($$values (%L::uuid, %L::uuid, 'Luis Bueno Coaching'::text, '2'::jsonb, '1'::jsonb, '1'::jsonb, '1'::jsonb, %L::jsonb)$$,
    :'owner', :'coach', jsonb_build_array(:'coach', :'stan')),
  'delete_coach is audited with the workspace name, counts and deleted accounts');

-- The Edge Function's next step works: deleting the coaches' accounts.
select lives_ok(format('delete from auth.users where id in (%L, %L)', :'coach', :'stan'),
  'the coaches'' accounts can then be deleted');
select is((select count(*)::int from public.admin_audit_log where action = 'delete_coach' and target_user_id = :'coach'), 1,
  'the audit row survives the coach''s account');

-- ---------- Afterwards the clients are like past clients ----------
select tests.act_as_aal(:'owner', 'aal2');
select results_eq(format('select kind, coach_name from public.admin_people() where user_id = %L', :'vic'),
  $$values ('client'::text, null::text)$$, 'Vic is listed as a client with no coach (Clients page: "No coach")');
select tests.act_as_aal(:'support', 'aal2');
select ok(public.admin_can_invite(:'ws2', array['ac-vic@t.local']), 'support can invite Vic to another coach');
select tests.act_as(:'vic');
select results_eq('select workspace_name from public.my_removal()', $$values ('Luis Bueno Coaching'::text)$$,
  'the phone tells Vic which coach closed');
reset role;
select set_config('request.jwt.claims', '', true);
select tests.add_client(:'ws2', :'vic');
select is((select count(*)::int from public.closed_workspace_clients where user_id = :'vic'), 0,
  'joining another coach clears the record');
select is((select count(*)::int from public.closed_workspace_clients where user_id = :'kay'), 1, 'Kay''s record stays');
select lives_ok(format('delete from auth.users where id = %L', :'kay'), 'Kay can still delete her account');
select is((select count(*)::int from public.closed_workspace_clients where user_id = :'kay'), 0,
  'and her record goes with it');

select * from finish();
rollback;
