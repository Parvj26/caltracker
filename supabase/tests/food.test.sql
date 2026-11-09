begin;
select plan(80);

-- Fixtures (as postgres)
select tests.create_user('food-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('food-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('food-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('food-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('food-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('Food Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('Food Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');
select gen_random_uuid() as m1, gen_random_uuid() as m2, gen_random_uuid() as m3, gen_random_uuid() as m_a2,
  gen_random_uuid() as m_b1 \gset
select gen_random_uuid() as p1, gen_random_uuid() as p2 \gset

-- Structure
select ok((select bool_and(c.relrowsecurity) from pg_class c
  where c.oid in ('public.meals'::regclass, 'public.nutrition_targets'::regclass)), 'RLS is enabled on meals and targets');
select is((select public from storage.buckets where id = 'meal-photos'), false, 'meal-photos bucket is private');
select is((select allowed_mime_types from storage.buckets where id = 'meal-photos'), array['image/webp', 'image/jpeg'],
  'meal-photos takes WebP and JPEG only');
select ok(not has_table_privilege('anon', 'public.meals', 'select')
  and not has_table_privilege('anon', 'public.nutrition_targets', 'select'), 'anon has no access to food tables');
select ok(not has_column_privilege('authenticated', 'public.meals', 'client_id', 'insert')
  and not has_column_privilege('authenticated', 'public.meals', 'client_id', 'update')
  and not has_column_privilege('authenticated', 'public.meals', 'workspace_id', 'update'),
  'nobody sets a meal''s client, or moves it to another workspace');
select ok(has_column_privilege('authenticated', 'public.meals', 'coach_meal_id', 'insert')
  and has_column_privilege('authenticated', 'public.meals', 'coach_meal_id', 'update')
  and not has_column_privilege('anon', 'public.meals', 'coach_meal_id', 'insert'),
  'a client may link their meal to a coach meal; anon may not');

-- Client A1 logs meals
select tests.act_as(:'a1');
select lives_ok(format($$insert into public.meals (id, workspace_id, eaten_at, eaten_on, name, calories, protein_g)
  values (%L, %L, '2026-11-05 12:15+00', '2026-11-05', 'Lunch', 650, 42.5)$$, :'m1', :'ws_a'), 'a client logs macros');
select is((select client_id from public.meals where id = :'m1'), :'a1'::uuid, 'the meal is always the caller''s');
select lives_ok(format($$insert into public.meals (id, workspace_id, eaten_at, eaten_on, note, photo_path, photo_thumb_path,
  photo_width, photo_height) values (%L, %L, '2026-11-05 19:00+00', '2026-11-06', 'pasta', %L, %L, 1200, 1600)$$,
  :'m2', :'ws_a', :'ws_a' || '/' || :'a1' || '/' || :'m2' || '-' || :'p1' || '.webp', :'ws_a' || '/' || :'a1' || '/' || :'m2' || '-' || :'p1' || '-thumb.webp'),
  'a client logs a photo with a note (a day ahead of UTC is fine)');
select throws_ok(format($$insert into public.meals (id, workspace_id, eaten_on, note) values (%L, %L, current_date, 'just a note')$$,
  :'m3', :'ws_a'), '23514', null, 'a meal needs a photo or a macro');
select throws_ok(format($$insert into public.meals (workspace_id, eaten_on, calories) values (%L, current_date, 10001)$$, :'ws_a'),
  '23514', null, 'calories above 10000 are refused');
select throws_ok(format($$insert into public.meals (workspace_id, eaten_on, protein_g) values (%L, current_date, -1)$$, :'ws_a'),
  '23514', null, 'negative grams are refused');
select throws_ok(format($$insert into public.meals (workspace_id, eaten_on, fat_g, name) values (%L, current_date, 5, %L)$$,
  :'ws_a', repeat('x', 41)), '23514', null, 'a name over 40 characters is refused');
select throws_ok(format($$insert into public.meals (workspace_id, eaten_at, eaten_on, fat_g) values (%L, '2026-11-05 12:00+00', '2026-11-08', 5)$$,
  :'ws_a'), '23514', null, 'the day must be within a day of the time');
select throws_ok(format($$insert into public.meals (workspace_id, eaten_at, eaten_on, fat_g)
  values (%L, now() + interval '3 days', (now() + interval '3 days')::date, 5)$$, :'ws_a'),
  '23514', null, 'a meal days in the future is refused');
select throws_ok(format($$insert into public.meals (id, workspace_id, eaten_on, photo_path, photo_thumb_path) values (%L, %L, current_date, %L, %L)$$,
  :'m3', :'ws_a', :'ws_a' || '/' || :'a2' || '/' || :'m3' || '-' || :'p1' || '.webp', :'ws_a' || '/' || :'a2' || '/' || :'m3' || '-' || :'p1' || '-thumb.webp'),
  '23514', null, 'a photo outside the client''s own folder is refused');
select throws_ok(format($$insert into public.meals (id, workspace_id, eaten_on, photo_path, photo_thumb_path) values (%L, %L, current_date, %L, %L)$$,
  :'m3', :'ws_a', :'ws_a' || '/' || :'a1' || '/' || :'m3' || '-' || :'p1' || '.webp', :'ws_a' || '/' || :'a1' || '/' || :'m3' || '-' || :'p1' || '-thumb.jpg'),
  '23514', null, 'the thumbnail must match the photo');
select throws_ok(format($$insert into public.meals (workspace_id, client_id, eaten_on, calories) values (%L, %L, current_date, 100)$$,
  :'ws_a', :'a2'), '42501', null, 'a client cannot log a meal as someone else');
select throws_ok(format($$insert into public.meals (workspace_id, eaten_on, calories) values (%L, current_date, 100)$$, :'ws_b'),
  '42501', null, 'a client cannot log a meal in another workspace');
select throws_ok(format($$insert into public.meals (id, workspace_id, eaten_on, calories) values (%L, %L, current_date, 100)$$,
  :'m1', :'ws_a'), '23505', null, 'a repeated offline save of the same meal is a duplicate (the phone updates instead)');
select lives_ok(format($$update public.meals set calories = 700, name = 'Big lunch' where id = %L$$, :'m1'), 'a client edits their meal');
select is((select calories from public.meals where id = :'m1'), 700::numeric, 'the edit is saved');
select is((select count(*)::int from public.meals), 2, 'A1 sees their two meals');

-- Another client of the same workspace
select tests.act_as(:'a2');
select lives_ok(format($$insert into public.meals (id, workspace_id, eaten_on, carbs_g) values (%L, %L, current_date, 80)$$, :'m_a2', :'ws_a'),
  'A2 logs a meal');
select is((select count(*)::int from public.meals), 1, 'A2 sees only their own meal');
update public.meals set calories = 1 where id = :'m1';
delete from public.meals where id = :'m1';
select tests.act_as(:'a1');
select is((select calories from public.meals where id = :'m1'), 700::numeric, 'A2 cannot edit or delete A1''s meal');

-- Another workspace
select tests.act_as(:'b1');
select lives_ok(format($$insert into public.meals (id, workspace_id, eaten_on, fat_g) values (%L, %L, current_date, 10)$$, :'m_b1', :'ws_b'),
  'B1 logs a meal in their workspace');
select is((select count(*)::int from public.meals), 1, 'B1 sees only their own meal');
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.meals where workspace_id = :'ws_a'), 0, 'coach B sees no meals of workspace A');
select is((select count(*)::int from public.meals), 1, 'coach B sees B1''s meal');

-- Coach A reads but never writes meals
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.meals), 3, 'coach A reads every meal in the workspace');
select throws_ok(format($$insert into public.meals (workspace_id, eaten_on, calories) values (%L, current_date, 100)$$, :'ws_a'),
  '42501', null, 'a coach cannot log a meal');
update public.meals set calories = 1 where id = :'m1';
delete from public.meals where id = :'m1';
select is((select calories from public.meals where id = :'m1'), 700::numeric, 'a coach cannot edit or delete a client''s meal');

-- Anonymous
select tests.act_as_anon();
select throws_ok($$select count(*) from public.meals$$, '42501', null, 'anon cannot read meals');
select throws_ok($$select count(*) from public.nutrition_targets$$, '42501', null, 'anon cannot read targets');

-- Targets
select tests.act_as(:'coach_a');
select lives_ok(format($$select public.set_nutrition_targets(%L, %L, 2200, 160, null, 70)$$, :'ws_a', :'a1'),
  'coach A sets A1''s targets (carbs left blank)');
select is((select array[calories, protein_g, carbs_g, fat_g] from public.nutrition_targets where client_id = :'a1'),
  array[2200, 160, null, 70]::numeric[], 'the targets are stored');
select is((select updated_by from public.nutrition_targets where client_id = :'a1'), :'coach_a'::uuid, 'the coach is recorded');
select lives_ok(format($$select public.set_nutrition_targets(%L, %L, 2000, 150, 220, null)$$, :'ws_a', :'a1'),
  'setting again replaces the targets');
select is((select array[calories, protein_g, carbs_g, fat_g] from public.nutrition_targets where client_id = :'a1'),
  array[2000, 150, 220, null]::numeric[], 'the new targets replace the old');
select is((select count(*)::int from public.nutrition_targets where client_id = :'a1'), 1, 'still one row per client');
select throws_ok(format($$select public.set_nutrition_targets(%L, %L, 20000, null, null, null)$$, :'ws_a', :'a1'),
  '23514', null, 'a target out of range is refused');
select throws_ok(format($$select public.set_nutrition_targets(%L, %L, 2000, null, null, null)$$, :'ws_b', :'b1'),
  '42501', null, 'coach A cannot set targets in another workspace');
select throws_ok(format($$select public.set_nutrition_targets(%L, %L, 2000, null, null, null)$$, :'ws_a', :'b1'),
  '42501', null, 'coach A cannot set targets for someone who is not their client');
select throws_ok(format($$insert into public.nutrition_targets (workspace_id, client_id, calories) values (%L, %L, 100)$$, :'ws_b', :'b1'),
  '42501', null, 'coach A cannot insert targets into another workspace directly');

select tests.act_as(:'coach_b');
select throws_ok(format($$select public.set_nutrition_targets(%L, %L, 1, null, null, null)$$, :'ws_a', :'a1'),
  '42501', null, 'coach B cannot set A1''s targets');
select is((select count(*)::int from public.nutrition_targets), 0, 'coach B reads no targets of workspace A');

select tests.act_as(:'a1');
select is((select calories from public.nutrition_targets), 2000::numeric, 'A1 reads their own targets');
select throws_ok(format($$select public.set_nutrition_targets(%L, %L, 5000, null, null, null)$$, :'ws_a', :'a1'),
  '42501', null, 'a client cannot set their own targets');
update public.nutrition_targets set calories = 5000;
select is((select calories from public.nutrition_targets), 2000::numeric, 'a client cannot edit their targets directly');

select tests.act_as(:'a2');
select is((select count(*)::int from public.nutrition_targets), 0, 'A2 cannot read A1''s targets');
select tests.act_as(:'b1');
select is((select count(*)::int from public.nutrition_targets), 0, 'B1 cannot read workspace A''s targets');

-- Storage
select tests.act_as(:'a1');
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('meal-photos', %L)$$, :'ws_a' || '/' || :'a1' || '/' || :'m2' || '-' || :'p1' || '.webp'),
  'A1 uploads a meal photo to their folder');
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('meal-photos', %L)$$, :'ws_a' || '/' || :'a1' || '/' || :'m2' || '-' || :'p1' || '-thumb.webp'),
  'A1 uploads its thumbnail');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('meal-photos', %L)$$, :'ws_a' || '/' || :'a2' || '/' || :'m3' || '-' || :'p1' || '.webp'),
  '42501', null, 'A1 cannot upload into A2''s folder');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('meal-photos', %L)$$, :'ws_b' || '/' || :'a1' || '/' || :'m3' || '-' || :'p1' || '.webp'),
  '42501', null, 'A1 cannot upload into another workspace');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('meal-photos', %L)$$, :'ws_a' || '/' || :'a1' || '/' || :'m3' || '-' || :'p1' || '.png'),
  '42501', null, 'only .webp and .jpg names are accepted');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('meal-photos', 'junk/a.webp')$$,
  '42501', null, 'a malformed path is refused');
select is((select count(*)::int from storage.objects where bucket_id = 'meal-photos'), 2, 'A1 reads their photos');

-- Replacing a photo: the new photo has its own id, so its files never collide with the old ones.
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('meal-photos', %L)$$, :'ws_a' || '/' || :'a1' || '/' || :'m2' || '-' || :'p2' || '.jpg'),
  'A1 uploads a replacement photo beside the old one');
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('meal-photos', %L)$$, :'ws_a' || '/' || :'a1' || '/' || :'m2' || '-' || :'p2' || '-thumb.jpg'),
  'and its thumbnail');
select lives_ok(format($$update public.meals set photo_path = %L, photo_thumb_path = %L where id = %L$$,
  :'ws_a' || '/' || :'a1' || '/' || :'m2' || '-' || :'p2' || '.jpg', :'ws_a' || '/' || :'a1' || '/' || :'m2' || '-' || :'p2' || '-thumb.jpg', :'m2'),
  'A1 points the meal at the replacement photo');
select is((select photo_path from public.meals where id = :'m2'), :'ws_a' || '/' || :'a1' || '/' || :'m2' || '-' || :'p2' || '.jpg',
  'the meal shows the new photo');
select throws_ok(format($$update public.meals set photo_path = %L, photo_thumb_path = %L where id = %L$$,
  :'ws_a' || '/' || :'a1' || '/' || :'m2' || '.webp', :'ws_a' || '/' || :'a1' || '/' || :'m2' || '-thumb.webp', :'m2'),
  '23514', null, 'a photo path without its own photo id is refused');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('meal-photos', %L)$$, :'ws_a' || '/' || :'a1' || '/' || :'m2' || '.webp'),
  '42501', null, 'a file without a photo id cannot be uploaded');

select tests.act_as(:'a2');
select is((select count(*)::int from storage.objects where bucket_id = 'meal-photos'), 0, 'A2 cannot read A1''s photos');
select ok(not public.can_access_meal_photo(:'ws_a' || '/' || :'a1' || '/' || :'m2' || '-' || :'p1' || '.webp', true), 'A2 cannot delete A1''s photos');
select tests.act_as(:'b1');
select is((select count(*)::int from storage.objects where bucket_id = 'meal-photos'), 0, 'B1 cannot read A1''s photos');
select tests.act_as(:'coach_b');
select is((select count(*)::int from storage.objects where bucket_id = 'meal-photos'), 0, 'coach B cannot read A1''s photos');
select tests.act_as(:'coach_a');
select is((select count(*)::int from storage.objects where bucket_id = 'meal-photos'), 4, 'coach A reads A1''s photos');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('meal-photos', %L)$$, :'ws_a' || '/' || :'a1' || '/' || :'m3' || '-' || :'p1' || '.webp'),
  '42501', null, 'coach A cannot upload into a client''s folder');
select ok(not public.can_access_meal_photo(:'ws_a' || '/' || :'a1' || '/' || :'m2' || '-' || :'p1' || '.webp', true), 'coach A cannot delete a client''s photos');
select tests.act_as(:'a1');
select ok(public.can_access_meal_photo(:'ws_a' || '/' || :'a1' || '/' || :'m2' || '-' || :'p1' || '.webp', true), 'A1 may delete their own photos');
select tests.act_as_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'meal-photos'), 0, 'anon reads no photos');

-- A1 deletes a meal
select tests.act_as(:'a1');
delete from public.meals where id = :'m1';
select is((select count(*)::int from public.meals where id = :'m1'), 0, 'a client deletes their meal');

-- A removed client keeps nothing; the coach keeps the history
select tests.act_as(:'coach_a');
select lives_ok(format('select public.remove_client(%L, %L)', :'ws_a', :'a2'), 'coach A removes A2');
select tests.act_as(:'a2');
select is((select count(*)::int from public.meals), 0, 'a removed client reads no meals');
select throws_ok(format($$insert into public.meals (workspace_id, eaten_on, calories) values (%L, current_date, 100)$$, :'ws_a'),
  '42501', null, 'a removed client cannot log meals');
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.meals where client_id = :'a2'), 1, 'the coach still reads a removed client''s meals');
select throws_ok(format($$select public.set_nutrition_targets(%L, %L, 2000, null, null, null)$$, :'ws_a', :'a2'),
  '42501', null, 'the coach cannot set targets for a past client');

select * from finish();
rollback;
