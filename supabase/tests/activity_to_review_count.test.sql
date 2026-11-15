-- activity_to_review_count (migration 20261114000200): the Activity heading's "N to review", over every log, not one page.
begin;
select plan(13);

select tests.create_user('arc-coach@t.local', 'Coach') as coach \gset
select tests.create_workspace('ARC Coaching', :'coach') as ws \gset
select tests.create_user('arc-coach2@t.local', 'Other Coach') as coach2 \gset
select tests.create_workspace('ARC Other', :'coach2') as ws2 \gset
select tests.create_user('arc-sam@t.local', 'Sam') as sam \gset
select tests.add_client(:'ws', :'sam');
select tests.create_user('arc-kim@t.local', 'Kim') as kim \gset
select tests.add_client(:'ws', :'kim');
select tests.create_user('arc-lee@t.local', 'Lee') as lee \gset
select tests.add_client(:'ws2', :'lee');

select ok(not has_function_privilege('anon', 'public.activity_to_review_count(uuid, uuid)', 'execute'), 'anon cannot call it');
select is((select prosecdef from pg_proc where oid = 'public.activity_to_review_count(uuid, uuid)'::regprocedure), false,
  'security invoker (RLS applies)');

-- 30 client-logged workouts for sam: more than one Activity page (25).
select tests.create_log(:'ws', :'sam') from generate_series(1, 30);
select tests.create_log(:'ws', :'kim') as kim_log \gset
-- Reviewed: the coach commented.
select tests.create_log(:'ws', :'kim') as kim_commented \gset
insert into public.workout_log_comments (log_id, body, author_id) values (:'kim_commented', 'Nice', :'coach');
-- Not reviewed: only the client commented.
insert into public.workout_log_comments (log_id, body, author_id) values (:'kim_log', 'Felt hard', :'kim');
-- Reviewed: the coach logged it in person.
insert into public.workout_logs (workspace_id, client_id, name, status, started_at, finished_at, logged_by)
  values (:'ws', :'kim', 'In person', 'completed', now() - interval '1 hour', now(), :'coach');
-- A coach comment whose author is gone does not count.
select tests.create_log(:'ws', :'kim') as kim_orphan \gset
insert into public.workout_log_comments (log_id, body, author_id) values (:'kim_orphan', 'Old', null);
-- Not finished: never counted.
select tests.create_log(:'ws', :'kim', null, 'in_progress');
-- Another workspace's log.
select tests.create_log(:'ws2', :'lee');

select tests.act_as(:'coach');
select is(public.activity_to_review_count(:'ws'), 32, 'all 32 waiting logs count, beyond the first page');
select is(public.activity_to_review_count(:'ws', :'sam'), 30, 'client filter: sam');
select is(public.activity_to_review_count(:'ws', :'kim'), 2, 'client filter: kim (coach comment and coach-logged are reviewed)');
select is(public.activity_to_review_count(:'ws2'), 0, 'not the coach of another workspace: 0');
select is(public.activity_to_review_count(:'ws', :'lee'), 0, 'another workspace''s client: 0');
reset role;

-- A coach comment on one of sam's logs drops the count by one.
insert into public.workout_log_comments (log_id, body, author_id)
  values ((select id from public.workout_logs where client_id = :'sam' limit 1), 'Good', :'coach');
select tests.act_as(:'coach');
select is(public.activity_to_review_count(:'ws'), 31, 'a coach comment marks a log reviewed');
reset role;

select tests.act_as(:'coach2');
select is(public.activity_to_review_count(:'ws'), 0, 'coach2 cannot count ws');
select is(public.activity_to_review_count(:'ws2'), 1, 'coach2 counts their own');
reset role;
select tests.act_as(:'sam');
select is(public.activity_to_review_count(:'ws'), 0, 'a client gets 0');
reset role;
select tests.act_as(:'lee');
select is(public.activity_to_review_count(:'ws'), 0, 'another workspace''s client gets 0');
reset role;
select tests.act_as_anon();
select throws_ok(format('select public.activity_to_review_count(%L)', :'ws'), '42501', null, 'anon is refused');
reset role;

select * from finish();
rollback;
