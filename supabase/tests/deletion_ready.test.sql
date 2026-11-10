begin;
select plan(54);

-- Account deletion (Apple requires it in the app). The delete-account Edge Function removes the client's files
-- through the Storage API, then deletes the auth user; this file proves the database half: deleting the auth user
-- erases every row about the client, in every table, and nothing of anyone else.

-- ---------- Catalog guards: a new table or bucket must be thought about before it ships ----------

-- Every foreign key pointing at a user (auth.users), a profile or a membership, as table(columns)>target:action.
-- c = cascade (erased with the account), n = set null (the row belongs to someone else and stays).
-- A new table that references a user fails here: add it to this list AND seed it in "Everything goes" below.
select is(
  (select array_agg(k order by k) from (
    select format('%s(%s)>%s:%s', c.conrelid::regclass,
      (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = c.conrelid and a.attnum = any(c.conkey)),
      c.confrelid::regclass, c.confdeltype) as k
    from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass, 'public.workspace_members'::regclass)
  ) x),
  array[
    'admin_users(created_by)>auth.users:n', 'admin_users(user_id)>auth.users:c',
    'awards(client_id)>auth.users:c',
    'body_measurements(client_id)>auth.users:c', 'body_measurements(entered_by)>auth.users:n',
    'client_documents(client_id)>auth.users:c', 'client_documents(uploaded_by)>auth.users:n',
    'client_goals(client_id)>auth.users:c',
    'client_invites(accepted_by)>auth.users:c', 'client_invites(created_by)>auth.users:n',
    'client_limitations(client_id)>auth.users:c',
    'client_notes(client_id)>auth.users:c', 'client_notes(created_by)>auth.users:n',
    'client_stats(client_id)>auth.users:c',
    'coach_meals(created_by)>auth.users:n',
    'community_blocks(blocked_id)>auth.users:c', 'community_blocks(blocker_id)>auth.users:c',
    'community_comments(author_id)>profiles:c',
    'community_members(removed_by)>auth.users:n', 'community_members(workspace_id,user_id)>workspace_members:c',
    'community_notifications(actor_id)>auth.users:c', 'community_notifications(recipient_id)>auth.users:c',
    'community_posts(author_id)>profiles:c', 'community_posts(pinned_by)>auth.users:n',
    'community_reactions(user_id)>profiles:c',
    'community_reports(reporter_id)>auth.users:c', 'community_reports(resolved_by)>auth.users:n',
    'community_reports(target_author_id)>auth.users:c',
    'conversation_reads(user_id)>auth.users:c',
    'conversations(client_id)>auth.users:c',
    'exercise_favorites(coach_id)>auth.users:c',
    'exercises(created_by)>auth.users:n',
    'meals(client_id)>auth.users:c',
    'messages(sender_id)>auth.users:c',
    'notification_prefs(user_id)>auth.users:c',
    'nutrition_targets(client_id)>auth.users:c', 'nutrition_targets(updated_by)>auth.users:n',
    'past_clients(removed_by)>auth.users:n', 'past_clients(user_id)>auth.users:c',
    'personal_records(client_id)>auth.users:c',
    'profiles(id)>auth.users:c',
    'program_assignments(client_id)>auth.users:c', 'program_assignments(created_by)>auth.users:n',
    'programs(created_by)>auth.users:n',
    'push_devices(user_id)>auth.users:c',
    'push_outbox(user_id)>auth.users:c',
    'sticker_awards(client_id)>auth.users:c',
    'workout_log_comments(author_id)>auth.users:n',
    'workout_logs(client_id)>auth.users:c', 'workout_logs(corrected_by)>auth.users:n',
    'workout_logs(logged_by)>auth.users:n', 'workout_logs(taken_over_from)>auth.users:n',
    'workouts(client_id)>auth.users:c', 'workouts(created_by)>auth.users:n',
    'workspace_members(user_id)>auth.users:c'
  ]::text[] collate "C",
  'every foreign key to a user is on the reviewed list (a new one must be added here and seeded below)');

select is(
  (select count(*)::int from pg_constraint c
   where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.confdeltype not in ('c', 'n')),
  0, 'no foreign key to auth.users can block deleting an account (each is cascade or set null)');

-- User ids kept without a foreign key. The client_id copies on workout and log children go with their parent row;
-- the admin audit log is append-only and is kept on purpose (it records what support staff did).
select is(
  (select array_agg(c.table_name || '.' || c.column_name order by c.table_name || '.' || c.column_name collate "C")
   from information_schema.columns c
   join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
   where c.table_schema = 'public' and c.udt_name = 'uuid'
     and c.column_name ~ '((^|_)(user|client|author|actor|sender|recipient|owner|admin|member|coach|blocker|blocked|reporter)_id|_by)$'
     and not exists (
       select 1 from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
       where k.contype = 'f' and k.conrelid = to_regclass('public.' || quote_ident(c.table_name))
         and a.attname = c.column_name)),
  array[
    'admin_audit_log.admin_id', 'admin_audit_log.target_user_id',
    'log_blocks.client_id', 'log_exercises.client_id', 'log_sets.client_id',
    'workout_blocks.client_id', 'workout_exercises.client_id', 'workout_log_comments.client_id',
    'workout_sets.client_id', 'workout_substitutes.client_id'
  ]::text[],
  'user id columns without a foreign key are on the reviewed list');

-- Every bucket is handled by storage_objects_for_user (client folders) or holds only coach library files.
select is((select array_agg(id::text order by id::text collate "C") from storage.buckets),
  array['avatars', 'client-documents', 'coach-meal-photos', 'community-images', 'exercise-images', 'meal-photos',
        'message-images', 'scan-attachments']::text[],
  'the bucket list is the reviewed one (a new bucket must be added to storage_objects_for_user)');

-- ---------- Grants ----------
select ok(has_function_privilege('service_role', 'public.storage_objects_for_user(uuid)', 'execute'),
  'the service role can list a user''s files');
select ok(not has_function_privilege('authenticated', 'public.storage_objects_for_user(uuid)', 'execute'),
  'signed-in users cannot list anyone''s files');
select ok(not has_function_privilege('anon', 'public.storage_objects_for_user(uuid)', 'execute'),
  'anon cannot list anyone''s files');
select ok(has_function_privilege('service_role', 'public.account_deletion_info(uuid)', 'execute'),
  'the service role can read the deletion summary');
select ok(not has_function_privilege('authenticated', 'public.account_deletion_info(uuid)', 'execute'),
  'signed-in users cannot read a deletion summary');
select ok(not has_function_privilege('anon', 'public.account_deletion_info(uuid)', 'execute'),
  'anon cannot read a deletion summary');

-- ---------- Seed: a coach, the client who leaves (Vic), a client who stays (Kay), and a second coach ----------
select tests.create_user('dr-coach@t.local', 'Luis Bueno') as coach \gset
select tests.create_workspace('DR Coaching', :'coach') as ws \gset
select tests.create_user('dr-coach2@t.local', 'Other Coach') as coach2 \gset
select tests.create_workspace('DR Other', :'coach2') as ws2 \gset
select tests.create_user('dr-vic@t.local', 'Vic Leaves') as vic \gset
select tests.create_user('dr-kay@t.local', 'Kay Stays') as kay \gset
select tests.add_client(:'ws', :'vic');
select tests.add_client(:'ws', :'kay');
select id as comm from public.communities where workspace_id = :'ws' \gset

-- Vic was a client of the other coach earlier.
insert into public.past_clients (workspace_id, user_id, email, first_name, last_name, removed_by)
values (:'ws2', :'vic', 'dr-vic@t.local', 'Vic', 'Leaves', :'coach2');

-- Invites: the accepted one (with a plan item), and an older expired one to the same address.
select tests.create_invite(:'ws', 'dr-vic@t.local', 'Vic Leaves', :'coach', 'dr-vic-token') as inv \gset
update public.client_invites set accepted_at = now(), accepted_by = :'vic' where id = :'inv';
select tests.create_invite(:'ws', 'dr-vic@t.local', 'Vic Leaves', :'coach', 'dr-vic-old',
  now() - interval '1 day', now() - interval '15 days') as inv_old \gset
select tests.create_invite(:'ws', 'dr-kay@t.local', 'Kay Stays', :'coach', 'dr-kay-token') as inv_kay \gset
update public.client_invites set accepted_at = now(), accepted_by = :'kay' where id = :'inv_kay';

-- The coach's library: a program, a library workout, a custom exercise, a coach meal.
insert into public.programs (workspace_id, name, created_by) values (:'ws', 'DR Strength', :'coach') returning id as prog \gset
select tests.create_workout(:'ws', 'DR Library day') as lib_workout \gset
select tests.create_exercise(:'ws', 'DR Coach press') as coach_ex \gset
insert into public.exercise_favorites (coach_id, exercise_id) values (:'coach', :'coach_ex');
insert into public.coach_meals (workspace_id, name, calories, created_by)
values (:'ws', 'DR Oats', 400, :'coach') returning id as coach_meal \gset
insert into public.client_invite_plan_items (invite_id, workspace_id, program_id, start_on)
values (:'inv', :'ws', :'prog', current_date);

-- Vic's training: an assignment, an assigned workout, a finished log with a coach comment, awards and stats.
insert into public.program_assignments (workspace_id, client_id, program_id, program_name, weeks, start_date, created_by)
values (:'ws', :'vic', :'prog', 'DR Strength', 4, current_date, :'coach');
select tests.create_workout(:'ws', 'DR Vic day', :'vic', current_date) as vic_workout \gset
select tests.create_log(:'ws', :'vic', :'vic_workout') as vic_log \gset
insert into public.workout_log_comments (log_id, workspace_id, client_id, author_id, body)
values (:'vic_log', :'ws', :'vic', :'coach', 'Great work');
insert into public.awards (log_id, client_id, workspace_id, result) values (:'vic_log', :'vic', :'ws', '{}');
insert into public.sticker_awards (client_id, workspace_id, sticker_key, first_log_id) values (:'vic', :'ws', 'cat', :'vic_log');
insert into public.client_stats (client_id, workspace_id, workouts) values (:'vic', :'ws', 1);
insert into public.personal_records (client_id, workspace_id, exercise_id, kind, value_kg, achieved_at, log_id)
values (:'vic', :'ws', :'coach_ex', 'heaviest', 60, now(), :'vic_log');

-- Messages: both sides, with photos, and both read markers.
insert into public.conversations (workspace_id, client_id) values (:'ws', :'vic') returning id as conv \gset
insert into public.messages (conversation_id, workspace_id, sender_id, body, image_paths)
values (:'conv', :'ws', :'coach', 'Hi Vic', array[:'ws' || '/' || :'conv' || '/coach.webp']),
       (:'conv', :'ws', :'vic', 'Hi coach', array[:'ws' || '/' || :'conv' || '/vic.webp']);
insert into public.conversation_reads (conversation_id, user_id) values (:'conv', :'vic'), (:'conv', :'coach');

-- Body scans, documents, goal, limitations, coach notes.
select gen_random_uuid() as scan_file \gset
insert into public.body_measurements (workspace_id, client_id, measured_on, entered_by, source, attachment_path)
values (:'ws', :'vic', current_date, :'coach', 'coach', :'ws' || '/' || :'vic' || '/' || :'scan_file' || '.pdf')
returning id as scan \gset
insert into public.body_measurement_values (measurement_id, metric_key, value) values (:'scan', 'weight_kg', 80);
select gen_random_uuid() as doc_file \gset
insert into public.client_documents (workspace_id, client_id, name, storage_path, content_type, size_bytes, uploaded_by)
values (:'ws', :'vic', 'InBody', :'ws' || '/' || :'vic' || '/' || :'doc_file' || '.pdf', 'application/pdf', 100, :'coach');
insert into public.client_goals (workspace_id, client_id, goal) values (:'ws', :'vic', 'Run 5k');
insert into public.client_limitations (workspace_id, client_id, body) values (:'ws', :'vic', 'Knee');
insert into public.client_notes (workspace_id, client_id, body, created_by) values (:'ws', :'vic', 'Note', :'coach');

-- Food: a meal from the coach's list, a photo meal, and targets.
insert into public.meals (workspace_id, client_id, eaten_on, name, calories, coach_meal_id)
values (:'ws', :'vic', current_date, 'DR Oats', 400, :'coach_meal');
insert into public.nutrition_targets (workspace_id, client_id, calories, updated_by) values (:'ws', :'vic', 2000, :'coach');

-- Push: a device, preferences and a sent notification.
insert into public.push_devices (token, user_id) values (repeat('a', 64), :'vic');
insert into public.notification_prefs (user_id) values (:'vic');
insert into public.push_outbox (user_id, workspace_id, type, group_key) values (:'vic', :'ws', 'message', 'dr-vic');

-- Kay's own things, which must all survive.
select tests.create_log(:'ws', :'kay') as kay_log \gset
insert into public.conversations (workspace_id, client_id) values (:'ws', :'kay') returning id as kay_conv \gset
insert into public.messages (conversation_id, workspace_id, sender_id, body) values (:'kay_conv', :'ws', :'coach', 'Hi Kay');
insert into public.meals (workspace_id, client_id, eaten_on, calories) values (:'ws', :'kay', current_date, 300);
insert into public.body_measurements (workspace_id, client_id, measured_on, source) values (:'ws', :'kay', current_date, 'client');
insert into public.sticker_awards (client_id, workspace_id, sticker_key) values (:'kay', :'ws', 'cat');

-- Community: a post each; Vic comments and reacts on Kay's post and Kay on Vic's; blocks and reports both ways;
-- a notification to Vic and one from Vic.
insert into public.community_posts (community_id, workspace_id, author_id, body, image_count)
values (:'comm', :'ws', :'vic', 'Vic post', 1) returning id as vic_post \gset
insert into public.community_post_images (post_id, workspace_id, position, path, thumb_path, width, height)
values (:'vic_post', :'ws', 0, :'ws' || '/' || :'vic' || '/' || :'vic_post' || '/a.webp',
  :'ws' || '/' || :'vic' || '/' || :'vic_post' || '/a-thumb.webp', 100, 100);
insert into public.community_posts (community_id, workspace_id, author_id, body)
values (:'comm', :'ws', :'kay', 'Kay post') returning id as kay_post \gset
insert into public.community_comments (post_id, community_id, workspace_id, author_id, body)
values (:'kay_post', :'comm', :'ws', :'vic', 'Nice from Vic'), (:'vic_post', :'comm', :'ws', :'kay', 'Nice from Kay');
insert into public.community_reactions (post_id, community_id, workspace_id, user_id, reaction)
values (:'kay_post', :'comm', :'ws', :'vic', 'heart'), (:'vic_post', :'comm', :'ws', :'kay', 'fire');
insert into public.community_blocks (workspace_id, blocker_id, blocked_id) values (:'ws', :'vic', :'kay'), (:'ws', :'kay', :'vic');
insert into public.community_reports (workspace_id, community_id, reporter_id, target_kind, post_id, target_author_id,
  target_body, reason)
values (:'ws', :'comm', :'vic', 'post', :'kay_post', :'kay', 'Kay post', 'spam'),
       (:'ws', :'comm', :'kay', 'post', :'vic_post', :'vic', 'Vic post', 'spam');
insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, actor_id)
values (:'ws', :'comm', :'vic', 'comment', :'vic_post', :'kay'), (:'ws', :'comm', :'kay', 'comment', :'kay_post', :'vic');
insert into public.push_outbox (user_id, workspace_id, type, group_key, data)
values (:'kay', :'ws', 'community_activity', 'dr-kay-from-vic', jsonb_build_object('actorId', :'vic', 'actorName', 'Vic'));

-- Files. Some of Vic's were uploaded by the coach (owner = coach) and must still go.
insert into storage.objects (bucket_id, name, owner_id) values
  ('avatars', :'vic' || '/avatar.webp', :'vic'),
  ('client-documents', :'ws' || '/' || :'vic' || '/' || :'doc_file' || '.pdf', :'coach'),
  ('scan-attachments', :'ws' || '/' || :'vic' || '/' || :'scan_file' || '.pdf', :'coach'),
  ('meal-photos', :'ws' || '/' || :'vic' || '/m-1.webp', :'vic'),
  ('message-images', :'ws' || '/' || :'conv' || '/coach.webp', :'coach'),
  ('message-images', :'ws' || '/' || :'conv' || '/vic.webp', :'vic'),
  ('community-images', :'ws' || '/' || :'vic' || '/' || :'vic_post' || '/a.webp', :'vic'),
  ('avatars', :'kay' || '/avatar.webp', :'kay'),
  ('meal-photos', :'ws' || '/' || :'kay' || '/m-2.webp', :'kay'),
  ('message-images', :'ws' || '/' || :'kay_conv' || '/coach.webp', :'coach'),
  ('avatars', :'coach' || '/avatar.webp', :'coach'),
  ('coach-meal-photos', :'ws' || '/' || :'coach_meal' || '-p.webp', :'coach'),
  ('exercise-images', 'dr/coach-press.webp', :'coach');

-- ---------- What the Edge Function reads before deleting ----------
select results_eq(
  format('select bucket_id, name from public.storage_objects_for_user(%L) order by 1, 2', :'vic'),
  format($$values ('avatars'::text, %L::text), ('client-documents', %L), ('community-images', %L), ('meal-photos', %L),
    ('message-images', %L), ('message-images', %L), ('scan-attachments', %L)$$,
    :'vic' || '/avatar.webp',
    :'ws' || '/' || :'vic' || '/' || :'doc_file' || '.pdf',
    :'ws' || '/' || :'vic' || '/' || :'vic_post' || '/a.webp',
    :'ws' || '/' || :'vic' || '/m-1.webp',
    :'ws' || '/' || :'conv' || '/coach.webp',
    :'ws' || '/' || :'conv' || '/vic.webp',
    :'ws' || '/' || :'vic' || '/' || :'scan_file' || '.pdf'),
  'Vic''s files are listed, including those the coach uploaded, and nothing of Kay''s or the coach''s');

select results_eq(
  format('select is_coach, client_name, coach_email, coach_first_name from public.account_deletion_info(%L)', :'vic'),
  $$values (false, 'Vic Leaves'::text, 'dr-coach@t.local'::text, 'Luis'::text)$$,
  'a client: not a coach, with their name and their coach''s email captured before the delete');
select results_eq(
  format('select is_coach from public.account_deletion_info(%L)', :'coach'),
  $$values (true)$$, 'a coach is flagged so the function refuses');

-- Counts to compare afterwards.
create temp table before_counts as
select
  (select count(*) from public.workspaces where id in (:'ws', :'ws2')) as workspaces,
  (select count(*) from public.workspace_members where user_id in (:'coach', :'coach2', :'kay')) as members,
  (select count(*) from public.profiles where id in (:'coach', :'coach2', :'kay')) as profiles,
  (select count(*) from public.programs where workspace_id = :'ws') as programs,
  (select count(*) from public.workouts where workspace_id = :'ws' and client_id is null) as library_workouts,
  (select count(*) from public.exercises where workspace_id = :'ws') as exercises,
  (select count(*) from public.exercise_favorites where coach_id = :'coach') as favorites,
  (select count(*) from public.coach_meals where workspace_id = :'ws') as coach_meals,
  (select count(*) from public.workout_logs where client_id = :'kay') as kay_logs,
  (select count(*) from public.log_sets where client_id = :'kay') as kay_sets,
  (select count(*) from public.messages where conversation_id = :'kay_conv') as kay_messages,
  (select count(*) from public.meals where client_id = :'kay') as kay_meals,
  (select count(*) from public.body_measurements where client_id = :'kay') as kay_scans,
  (select count(*) from public.sticker_awards where client_id = :'kay') as kay_stickers,
  (select count(*) from public.client_invites where accepted_by = :'kay') as kay_invites,
  (select count(*) from public.community_posts where author_id = :'kay') as kay_posts,
  (select count(*) from public.communities where workspace_id = :'ws') as communities;

-- ---------- The delete ----------
select lives_ok(format('delete from auth.users where id = %L', :'vic'), 'deleting Vic''s account succeeds');

-- Every user column in public (with or without a foreign key), counted for Vic. Zero everywhere.
create function pg_temp.rows_for(p_user uuid) returns table (col text, n bigint)
language plpgsql as $$
declare
  r record;
begin
  for r in
    select distinct c.table_name::text as tbl, c.column_name::text as colname
    from information_schema.columns c
    join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
    where c.table_schema = 'public' and c.udt_name = 'uuid' and c.table_name <> 'admin_audit_log'
      and (
        c.column_name ~ '((^|_)(user|client|author|actor|sender|recipient|owner|admin|member|coach|blocker|blocked|reporter)_id|_by)$'
        or exists (
          select 1 from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
          where k.contype = 'f' and k.conrelid = to_regclass('public.' || quote_ident(c.table_name))
            and a.attname = c.column_name
            and k.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)))
  loop
    col := r.tbl || '.' || r.colname;
    execute format('select count(*) from public.%I where %I = $1', r.tbl, r.colname) into n using p_user;
    return next;
  end loop;
end;
$$;

select ok((select count(*) from pg_temp.rows_for(:'vic')) >= 60, 'the scan covers every user column (60 or more)');
select is((select string_agg(col || '=' || n, ', ') from pg_temp.rows_for(:'vic') where n > 0), null,
  'no row anywhere still holds Vic''s id');

select is((select count(*)::int from public.client_invites where email = 'dr-vic@t.local'), 0,
  'every invite to Vic''s address is gone (accepted and expired)');
select is((select count(*)::int from public.past_clients where email = 'dr-vic@t.local'), 0,
  'the other coach''s past-client record of Vic is gone');
select is((select count(*)::int from public.client_invite_plan_items where invite_id = :'inv'), 0,
  'the plan items of Vic''s invite are gone');
select is((select count(*)::int from public.push_outbox where data ->> 'actorId' = :'vic'), 0,
  'notifications to others that name Vic are gone');
select is((select count(*)::int from public.community_reports where target_body in ('Vic post', 'Kay post')), 0,
  'reports Vic filed and reports about Vic''s posts are gone (they copy Vic''s words)');
select is((select count(*)::int from public.community_comments where body = 'Nice from Vic'), 0,
  'Vic''s comment on Kay''s post is gone');
select is((select count(*)::int from public.community_reactions where post_id = :'kay_post'), 0,
  'Vic''s reaction on Kay''s post is gone');
select is((select count(*)::int from public.community_posts where id = :'vic_post'), 0, 'Vic''s post is gone');
select is((select count(*)::int from public.community_post_images where post_id = :'vic_post'), 0,
  'Vic''s post photos rows are gone');
select is((select count(*)::int from public.messages where conversation_id = :'conv'), 0,
  'both sides of Vic''s message thread are gone');
select is((select count(*)::int from public.body_measurement_values where measurement_id = :'scan'), 0,
  'Vic''s body scan values are gone');
select is((select count(*)::int from public.workout_log_comments where log_id = :'vic_log'), 0,
  'the coach''s comment on Vic''s log is gone');
select is((select count(*)::int from public.workouts where id = :'vic_workout'), 0, 'Vic''s assigned workout is gone');
select is((select count(*)::int from public.meals where coach_meal_id = :'coach_meal'), 0,
  'Vic''s meal from the coach''s list is gone');
select is((select count(*)::int from public.client_notes where body = 'Note'), 0, 'the coach''s notes about Vic are gone');
select is((select count(*)::int from auth.identities where user_id = :'vic'), 0, 'Vic''s sign-in identity is gone');

-- ---------- Everyone else is untouched ----------
create temp table after_counts as
select
  (select count(*) from public.workspaces where id in (:'ws', :'ws2')) as workspaces,
  (select count(*) from public.workspace_members where user_id in (:'coach', :'coach2', :'kay')) as members,
  (select count(*) from public.profiles where id in (:'coach', :'coach2', :'kay')) as profiles,
  (select count(*) from public.programs where workspace_id = :'ws') as programs,
  (select count(*) from public.workouts where workspace_id = :'ws' and client_id is null) as library_workouts,
  (select count(*) from public.exercises where workspace_id = :'ws') as exercises,
  (select count(*) from public.exercise_favorites where coach_id = :'coach') as favorites,
  (select count(*) from public.coach_meals where workspace_id = :'ws') as coach_meals,
  (select count(*) from public.workout_logs where client_id = :'kay') as kay_logs,
  (select count(*) from public.log_sets where client_id = :'kay') as kay_sets,
  (select count(*) from public.messages where conversation_id = :'kay_conv') as kay_messages,
  (select count(*) from public.meals where client_id = :'kay') as kay_meals,
  (select count(*) from public.body_measurements where client_id = :'kay') as kay_scans,
  (select count(*) from public.sticker_awards where client_id = :'kay') as kay_stickers,
  (select count(*) from public.client_invites where accepted_by = :'kay') as kay_invites,
  (select count(*) from public.community_posts where author_id = :'kay') as kay_posts,
  (select count(*) from public.communities where workspace_id = :'ws') as communities;

select is((select workspaces from after_counts), (select workspaces from before_counts), 'both workspaces remain');
select is((select members from after_counts), (select members from before_counts), 'the coaches and Kay keep their memberships');
select is((select profiles from after_counts), (select profiles from before_counts), 'the coaches and Kay keep their profiles');
select is((select programs from after_counts), (select programs from before_counts), 'the coach keeps their programs');
select is((select library_workouts from after_counts), (select library_workouts from before_counts),
  'the coach keeps their library workouts');
select is((select exercises from after_counts), (select exercises from before_counts), 'the coach keeps their exercises');
select is((select favorites from after_counts), (select favorites from before_counts), 'the coach keeps their favourites');
select is((select coach_meals from after_counts), (select coach_meals from before_counts), 'the coach keeps their meal list');
select is((select kay_logs from after_counts), (select kay_logs from before_counts), 'Kay keeps her logs');
select is((select kay_sets from after_counts), (select kay_sets from before_counts), 'Kay keeps her sets');
select is((select kay_messages from after_counts), (select kay_messages from before_counts), 'Kay keeps her messages');
select is((select kay_meals from after_counts), (select kay_meals from before_counts), 'Kay keeps her meals');
select is((select kay_scans from after_counts), (select kay_scans from before_counts), 'Kay keeps her body scans');
select is((select kay_stickers from after_counts), (select kay_stickers from before_counts), 'Kay keeps her stickers');
select is((select kay_invites from after_counts), (select kay_invites from before_counts), 'Kay keeps her invite record');
select is((select kay_posts from after_counts), (select kay_posts from before_counts), 'Kay keeps her community post');
select is((select communities from after_counts), (select communities from before_counts), 'the community remains');

-- ---------- Deleting a coach (dashboard or script) never takes the workspace's invites with them ----------
-- An invite belongs to the workspace: when the coach who sent it goes, it stays with created_by cleared.
select tests.create_user('dr-staff@t.local', 'Stan Staff') as stan \gset
insert into public.workspace_members (workspace_id, user_id, role) values (:'ws', :'stan', 'staff');
select tests.create_invite(:'ws', 'dr-kay2@t.local', 'Kay Two', :'stan', 'dr-stan-accepted') as stan_accepted \gset
update public.client_invites set accepted_at = now(), accepted_by = :'kay' where id = :'stan_accepted';
select tests.create_invite(:'ws', 'dr-new@t.local', 'New Client', :'stan', 'dr-stan-pending') as stan_pending \gset
insert into public.client_invite_plan_items (invite_id, workspace_id, program_id, start_on)
values (:'stan_pending', :'ws', :'prog', current_date);
select lives_ok(format('delete from auth.users where id = %L', :'stan'), 'deleting a staff coach succeeds');
select is((select count(*)::int from public.client_invites where id in (:'stan_accepted', :'stan_pending')), 2,
  'the invites the staff coach sent (accepted and pending) stay with the workspace');
select is((select count(*)::int from public.client_invites
           where id in (:'stan_accepted', :'stan_pending') and created_by is null), 2,
  'their sender is cleared');
select is((select count(*)::int from public.client_invite_plan_items where invite_id = :'stan_pending'), 1,
  'the pending invite keeps its plan');
select is((select accepted_by from public.client_invites where id = :'stan_accepted'), :'kay'::uuid,
  'Kay''s accepted invite still points at Kay');

select * from finish();
rollback;
