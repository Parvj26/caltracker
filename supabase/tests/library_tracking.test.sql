begin;
select plan(5);

select tests.create_user('coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_workspace('Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('Workspace B', :'coach_b') as ws_b \gset

select ok('weight_time' = any (enum_range(null::public.tracking_type)::text[]), 'weight_time is a tracking type');

-- The library fix leaves no built-in Arm Circles or Farmer's Walk on its old type (CI has no library: vacuous there,
-- but it checks a database that has the imported library, like a dev stack).
select is(
  (select count(*)::int from public.exercises
   where source = 'builtin'
     and ((external_id = 'Arm_Circles' and tracking_type <> 'reps')
       or (external_id = 'Farmers_Walk' and tracking_type <> 'weight_time'))),
  0, 'built-in Arm Circles is reps and Farmer''s Walk is weight and time');

select tests.act_as(:'coach_a');
insert into public.exercises (workspace_id, source, name, tracking_type)
values (:'ws_a', 'custom', 'Suitcase Carry', 'weight_time');
select is((select tracking_type::text from public.exercises where name = 'Suitcase Carry'), 'weight_time',
  'a coach creates a weight-and-time custom exercise');
update public.exercises set tracking_type = 'weight_time' where name = 'Suitcase Carry';
select lives_ok($$update public.exercises set tracking_type = 'reps' where name = 'Suitcase Carry'$$,
  'a coach changes a custom exercise to and from weight and time');
reset role;

select tests.act_as(:'coach_b');
select is((select count(*)::int from public.exercises where name = 'Suitcase Carry'), 0,
  'coach B cannot see workspace A''s weight-and-time exercise');
reset role;

select * from finish();
rollback;
