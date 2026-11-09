begin;
select plan(47);

-- Fixtures (as postgres)
select tests.create_user('cm-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('cm-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('cm-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('cm-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('cm-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('Coach Meals A', :'coach_a') as ws_a \gset
select tests.create_workspace('Coach Meals B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');
select gen_random_uuid() as cm1, gen_random_uuid() as cm_gone, gen_random_uuid() as cm_b, gen_random_uuid() as cm_x,
  gen_random_uuid() as p1 \gset
select gen_random_uuid() as m1, gen_random_uuid() as m2, gen_random_uuid() as m3, gen_random_uuid() as m4 \gset

-- Structure
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.coach_meals'::regclass), 'RLS is enabled on coach_meals');
select is((select public from storage.buckets where id = 'coach-meal-photos'), false, 'coach-meal-photos bucket is private');
select is((select allowed_mime_types from storage.buckets where id = 'coach-meal-photos'), array['image/webp', 'image/jpeg'],
  'coach-meal-photos takes WebP and JPEG only');
select is((select file_size_limit from storage.buckets where id = 'coach-meal-photos'), 3145728::bigint,
  'coach-meal-photos files are at most 3 MB');
select ok(not has_table_privilege('anon', 'public.coach_meals', 'select'), 'anon has no access to coach meals');
select ok(not has_column_privilege('authenticated', 'public.coach_meals', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.coach_meals', 'created_by', 'update')
  and not has_column_privilege('authenticated', 'public.coach_meals', 'created_by', 'insert'),
  'nobody moves a coach meal to another workspace or sets who made it');
select ok(has_column_privilege('authenticated', 'public.meals', 'coach_meal_id', 'insert')
  and has_column_privilege('authenticated', 'public.meals', 'coach_meal_id', 'update'), 'clients can set a meal''s coach link');

-- Coach A writes
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into public.coach_meals (id, workspace_id, name, calories, protein_g, carbs_g, fat_g,
  ingredients, how_to) values (%L, %L, 'Protein oats', 450, 35, 52, 11, '60 g oats', 'Microwave it')$$, :'cm1', :'ws_a'),
  'coach A shares a meal');
select is((select created_by from public.coach_meals where id = :'cm1'), :'coach_a'::uuid, 'the coach is recorded');
select lives_ok(format($$insert into public.coach_meals (id, workspace_id, name, calories) values (%L, %L, 'Old chili', 500)$$,
  :'cm_gone', :'ws_a'), 'coach A shares a second meal');
select lives_ok(format($$update public.coach_meals set deleted_at = now() where id = %L$$, :'cm_gone'), 'coach A removes it');
select throws_ok(format($$insert into public.coach_meals (workspace_id, name) values (%L, 'Sneaky')$$, :'ws_b'),
  '42501', null, 'coach A cannot share a meal in another workspace');
select throws_ok(format($$delete from public.coach_meals where id = %L$$, :'cm1'), '42501', null,
  'nobody hard-deletes a coach meal');
select throws_ok(format($$insert into public.coach_meals (workspace_id, name) values (%L, '')$$, :'ws_a'),
  '23514', null, 'an empty name is refused');
select throws_ok(format($$insert into public.coach_meals (workspace_id, name) values (%L, ' x')$$, :'ws_a'),
  '23514', null, 'an untrimmed name is refused');
select throws_ok(format($$insert into public.coach_meals (workspace_id, name) values (%L, %L)$$, :'ws_a', repeat('x', 41)),
  '23514', null, 'a name over 40 characters is refused');
select throws_ok(format($$insert into public.coach_meals (workspace_id, name, ingredients) values (%L, 'x', %L)$$, :'ws_a', repeat('x', 2001)),
  '23514', null, 'ingredients over 2000 characters are refused');
select throws_ok(format($$insert into public.coach_meals (workspace_id, name, how_to) values (%L, 'x', %L)$$, :'ws_a', repeat('x', 4001)),
  '23514', null, 'how to over 4000 characters is refused');
select throws_ok(format($$insert into public.coach_meals (workspace_id, name, calories) values (%L, 'x', 10001)$$, :'ws_a'),
  '23514', null, 'calories above 10000 are refused');
select throws_ok(format($$insert into public.coach_meals (id, workspace_id, name, photo_path, photo_thumb_path, photo_width, photo_height)
  values (%L, %L, 'x', %L, %L, 100, 100)$$, :'cm_x', :'ws_a', :'ws_b' || '/' || :'cm_x' || '-' || :'p1' || '.webp',
  :'ws_b' || '/' || :'cm_x' || '-' || :'p1' || '-thumb.webp'), '23514', null, 'a photo in another workspace''s folder is refused');
select throws_ok(format($$insert into public.coach_meals (id, workspace_id, name, photo_path, photo_thumb_path, photo_width, photo_height)
  values (%L, %L, 'x', %L, %L, 100, 100)$$, :'cm_x', :'ws_a', :'ws_a' || '/' || :'cm_x' || '-' || :'p1' || '.webp',
  :'ws_a' || '/' || :'cm_x' || '-' || :'p1' || '-thumb.jpg'), '23514', null, 'the thumbnail must match the photo');
select lives_ok(format($$insert into public.coach_meals (id, workspace_id, name, photo_path, photo_thumb_path, photo_width, photo_height)
  values (%L, %L, 'Photo meal', %L, %L, 1600, 1200)$$, :'cm_x', :'ws_a', :'ws_a' || '/' || :'cm_x' || '-' || :'p1' || '.webp',
  :'ws_a' || '/' || :'cm_x' || '-' || :'p1' || '-thumb.webp'), 'a meal with a photo in its own folder is fine');

select tests.act_as(:'coach_b');
select lives_ok(format($$insert into public.coach_meals (id, workspace_id, name, calories) values (%L, %L, 'B bowl', 600)$$,
  :'cm_b', :'ws_b'), 'coach B shares a meal in B');
select is((select count(*)::int from public.coach_meals where workspace_id = :'ws_a'), 0, 'coach B sees none of A''s meals');
update public.coach_meals set name = 'Hacked' where id = :'cm1';
select tests.act_as(:'coach_a');
select is((select name from public.coach_meals where id = :'cm1'), 'Protein oats', 'coach B cannot edit A''s meal');
select is((select count(*)::int from public.coach_meals), 3, 'coach A sees all A''s meals, removed ones too');

-- Clients read, never write
select tests.act_as(:'a1');
select is((select count(*)::int from public.coach_meals), 2, 'A1 sees A''s live meals only (not the removed one, not B''s)');
select throws_ok(format($$insert into public.coach_meals (workspace_id, name) values (%L, 'Mine')$$, :'ws_a'),
  '42501', null, 'a client cannot share a meal');
update public.coach_meals set name = 'Mine' where id = :'cm1';
select tests.act_as(:'coach_a');
select is((select name from public.coach_meals where id = :'cm1'), 'Protein oats', 'a client cannot edit a coach meal');

-- Linking client meals
select tests.act_as(:'a1');
select lives_ok(format($$insert into public.meals (id, workspace_id, eaten_on, name, calories, coach_meal_id)
  values (%L, %L, current_date, 'Protein oats', 450, %L)$$, :'m1', :'ws_a', :'cm1'), 'A1 logs a meal from A''s coach meal');
select throws_ok(format($$insert into public.meals (id, workspace_id, eaten_on, calories, coach_meal_id)
  values (%L, %L, current_date, 600, %L)$$, :'m2', :'ws_a', :'cm_b'), '23503', null, 'A1 cannot link a coach meal of workspace B');
select lives_ok(format($$insert into public.meals (id, workspace_id, eaten_on, calories) values (%L, %L, current_date, 600)$$,
  :'m2', :'ws_a'), 'A1 logs a plain meal');
select throws_ok(format($$update public.meals set coach_meal_id = %L where id = %L$$, :'cm_b', :'m2'), '23503', null,
  'A1 cannot relink a meal to workspace B''s coach meal');
select lives_ok(format($$insert into public.meals (id, workspace_id, eaten_on, calories, coach_meal_id)
  values (%L, %L, current_date, 500, %L)$$, :'m3', :'ws_a', :'cm_gone'), 'a queued save linked to a since-removed coach meal still saves');
select tests.act_as(:'a2');
select lives_ok(format($$insert into public.meals (id, workspace_id, eaten_on, calories, coach_meal_id)
  values (%L, %L, current_date, 450, %L)$$, :'m4', :'ws_a', :'cm1'), 'A2 logs the same coach meal');

-- Counts
select tests.act_as(:'coach_a');
select is((select logged from public.coach_meal_log_counts(:'ws_a') where coach_meal_id = :'cm1'), 2::bigint,
  'the coach sees how often each meal was logged');
select tests.act_as(:'a1');
select is((select logged from public.coach_meal_log_counts(:'ws_a') where coach_meal_id = :'cm1'), 1::bigint,
  'a client counts only their own meals');
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.coach_meal_log_counts(:'ws_a')), 0, 'coach B gets no counts for workspace A');

-- Storage
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('coach-meal-photos', %L)$$,
  :'ws_a' || '/' || :'cm_x' || '-' || :'p1' || '.webp'), 'coach A uploads a meal photo');
select tests.act_as(:'a1');
select is((select count(*)::int from storage.objects where bucket_id = 'coach-meal-photos'), 1, 'A1 reads the coach''s meal photos');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('coach-meal-photos', %L)$$,
  :'ws_a' || '/' || :'cm1' || '-' || :'p1' || '.webp'), '42501', null, 'a client cannot upload a coach meal photo');
select ok(not public.can_access_coach_meal_photo(:'ws_a' || '/' || :'cm_x' || '-' || :'p1' || '.webp', true), 'a client cannot delete one');
select ok(not public.can_access_coach_meal_photo('../x', false), 'a malformed name is never readable');
select tests.act_as(:'coach_b');
select is((select count(*)::int from storage.objects where bucket_id = 'coach-meal-photos'), 0, 'coach B cannot read A''s photos');
select tests.act_as(:'coach_a');
select ok(public.can_access_coach_meal_photo(:'ws_a' || '/' || :'cm_x' || '-' || :'p1' || '-thumb.webp', true), 'coach A may delete A''s photos');

-- A removed client sees nothing
select lives_ok(format('select public.remove_client(%L, %L)', :'ws_a', :'a2'), 'coach A removes A2');
select tests.act_as(:'a2');
select is((select count(*)::int from public.coach_meals), 0, 'a past client sees no coach meals');

select * from finish();
rollback;
